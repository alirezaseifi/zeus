// PUBLIC / PRIVATE KEYS can be generated by
// return crypto.subtle.generateKey({name: 'ECDH', namedCurve: 'P-256'},
//   true, ['deriveBits'])
// .then((keys) => {
//   return cryptoKeyToUrlBase64(keys.publicKey, keys.privateKey);
// });

const webpush = require('web-push');

// VAPID keys should only be generated only once.
const vapidKeys = webpush.generateVAPIDKeys();

console.log(vapidKeys);

webpush.setGCMAPIKey(process.env.SERVER_KEY);
webpush.setVapidDetails(
    'mailto:tomasloon@gmail.com',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);



// This is the same output of calling JSON.stringify on a PushSubscription
// const pushSubscription = {
//   endpoint: '.....',
//   keys: {
//     auth: '.....',
//     p256dh: '.....'
//   }
// };

// webpush.sendNotification(pushSubscription, 'Your Push Payload Text');