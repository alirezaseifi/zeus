require('dotenv').config({
    path: __dirname + '/.env'
});

const
    request = require('request-promise-native'),
    mongoose = require('mongoose'),
    webpush = require('web-push'),
    mime = require('mime-types'),
    xml2json = require('xml2json'),
    http = require('http'),
    fs = require('fs'),
    log = require('npmlog'),
    { exec } = require('child_process');

const CRON_TIME = 1 * 60 * 1000;

// PUBLIC / PRIVATE KEYS can be generated by `webpush.generateVAPIDKeys()`
const vapidKeys = {
    publicKey: process.env.PUBLIC_KEY,
    privateKey: process.env.PRIVATE_KEY
};

webpush.setGCMAPIKey(process.env.SERVER_KEY);
webpush.setVapidDetails(
    'mailto:tomasloon@gmail.com',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

mongoose.Promise = Promise;
mongoose.connect(process.env.MONGO_DB, {
    useMongoClient: true
});

const Deal = mongoose.model('Deal', {
    url: String,
    title: String,
    guid: { type: String, unique: true },
    date: Date,
    created: { type: Date, default: Date.now }
    // price
    // from
    // to
    // alliance
    // airline
    // source
});

const Subscriber = mongoose.model('Subscriber', {
    subscription: String,
    unsubscribed: Date,
    lastNotification: Date,
    created: { type: Date, default: Date.now }
});


// APP ITSELF

const respond = (res, status, data, type) => {
    res.writeHead(status, {
        'Content-Type': type || 'application/json'
    });
    res.end(data);
};

const json = (obj, status) => JSON.stringify({ status: status || 'ok', data: obj });

const post = (body, res) => {
    res.writeHead(200, {
        'Content-Type': 'application/json'
    });

    let data = JSON.parse(body);

    res.end(json(data));
};

const saveSubscriber = data => new Promise((resolve, reject) => {
    const next = err => {
        if (err) {
            reject(err);
        } else {
            resolve();
        }
    };

    if (data.isSubscribed) {
        (new Subscriber({
            subscription: JSON.stringify(data.subscription)
        })).save(next);
    } else {
        Subscriber.findOneAndUpdate({
            subscription: JSON.stringify(data.subscription)
        }, {
            $set: {
                unsubscribed: Date.now()
            }
        }, next);
    }
});

const parseBody = req => new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(JSON.parse(data)));
});

const server = http.createServer(async (req, res) => {

    if (req.method === 'GET' && process.env.ENV === 'local') {
        const path = __dirname + (req.url === '/' ? '/index.html' : req.url);
        if (fs.existsSync(path)) {
            res.writeHead(200, {
                'Content-Type': mime.lookup(path) || 'application/json'
            });
            return res.end(fs.readFileSync(path));
        }
    }

    let body;
    if (req.method === 'POST') {
        body = await parseBody(req);
    }

    const ok = () => respond(res, 200, json('saved'));
    const error = err => respond(res, 500, json(err, 'error'));

    if (req.url === '/log') {
        return exec(
            'journalctl -n 30 -u nodejs-zeus.service --no-pager | ccze -h -o cssfile="/log.css"',
            (error, stdout, stderr) => respond(res, 200, stdout, 'text/html')
        );
    }

    if (req.url === '/log.css') {
        return respond(res, 200, fs.readFileSync(__dirname + '/log.css').toString(), 'text/css');
    }

    if (req.url === '/list') {
        return getPastDeals(res);
    }

    if (req.url === '/subscribe' && req.method === 'POST') {
        saveSubscriber(body).then(ok).catch(error);
    } else {
        res.writeHead(404, {
            'Content-Type': 'text/plain'
        });
        res.end();
    }
});

server.listen(process.env.PORT || 3000);
log.info('', 'Server started at port ' + (process.env.PORT || 3000));


const SOURCES = [
    'http://www.secretflying.com/posts/category/usa/feed/',
    'http://www.theflightdeal.com/category/flight-deals/nyc/feed/',
    'http://www.flyertalk.com/forum/external.php?type=RSS2&forumids=372,740',
    'https://www.airfarewatchdog.com/rss/blog/'
];

let lastSave = 0;

const fetchDeals = () => {
    log.info('CRON', `fetchDeals() last saved item date: ${lastSave}`);
    console.time('[CRON] fetchDeals()');
    let promises = SOURCES.map(source =>
        request({
            url: source,
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1'
            }
        })
        .then(
            response => {
                try {
                    const json = xml2json.toJson(response, { object: true });
                    if (!json || !json.rss || !json.rss.channel || !json.rss.channel.item) {
                        log.warn('CRON', `Something went bad for ${source} \n ${response} \n`);
                    }
                    const arr = (json.rss.channel.item || []).map(
                        ({
                            title,
                            link,
                            pubDate,
                            guid
                        }) => ({
                            title,
                            url: link,
                            date: new Date(pubDate),
                            guid: (guid && guid.$t || link) + '#_' + Math.floor(Math.random() * 10000)
                        })
                    ).filter(item => item.date > lastSave);
                    log.info('DEBUG', `${json.rss.channel.item}`);
                    log.info('CRON', `SUCCESS ${source} (${arr.length} new items)`);
                    return arr;
                } catch (e) {
                    // log.warn('CRON', 'ERROR PARSING FEED: %j', e);
                    return [];
                }
            },
            err => {
                log.warn('CRON', `ERROR FETCHING FEED: ${source} ${err.statusCode}`);
                return new Promise(resolve => resolve([]));
            }
        )
    );

    Promise.all(promises).then(responses => {
        let items = responses
                        .reduce((accumulator, arr) => accumulator.concat(arr), [])
                        .filter(item => !!item.guid)
                        .sort((a, b) => a.date < b.date ? 1 : -1);

        if (items.length) {
            Deal.insertMany(items, { ordered: false })
            .then(
                docs => log.info('CRON', `Saved ${docs.length} new results @ ${+new Date()}`),
                err => log.error('CRON', 'ERROR INSERT: %j', err)
            )
            .then(() => {
                notifyAllSubscribers(items, items[0].date);
                lastSave = items[0].date;
                console.timeEnd('[CRON] fetchDeals()');
                setTimeout(fetchDeals, CRON_TIME);
            });
        } else {
            console.timeEnd('[CRON] fetchDeals()');
            setTimeout(fetchDeals, CRON_TIME);
        }
    })
    .catch(err => log.error('CRON', 'GENERIC ERROR: %j', err));
};

const notifyAllSubscribers = (docs, newSave) => {
    Subscriber.find().or([
        { lastNotification: null },
        { lastNotification: { $lt: lastSave } }
    ]).exec()
    .then(subscribers => subscribers.forEach(subscriber => {
        docs.forEach(({ title, url }) =>
            webpush.sendNotification(
                JSON.parse(subscriber.subscription), JSON.stringify({
                    body: title,
                    url: process.env.URL_PREFIX + url
                })
            ).catch(err => log.error('CRON', 'ERROR PUSH: %j', err))
        );
        log.info('CRON', 'Pushed notifications:', docs.length);
        return subscriber.update({ lastNotification: newSave }).exec();
    }))
    .catch(err => log.error('CRON', 'ERROR SUBSCRIBER: %j', err));
};

Deal.findOne().select('date').sort('-date').exec()
.then(lastItem => lastSave = lastItem && lastItem.date || 0)
.then(fetchDeals)
.catch(err => log.error('CRON', 'STARTUP FAIL: %j', err));


const getPastDeals = function (res) {
    Deal.find().select('date title url').sort('-date').limit(50).exec()
    .then(data => fs.readFileSync(__dirname + '/list.html').toString().replace('{{DATA}}', JSON.stringify(data)))
    .then(HTML => {
        res.writeHead(200, {
            'Content-Type': 'text/html;charset=UTF-8'
        });
        res.end(HTML);
    }).catch(err => {
        res.writeHead(200, {
            'Content-Type': 'text/html'
        });
        res.end(err.message);
    });
}
