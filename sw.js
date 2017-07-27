self.addEventListener('push', evt => {

    const title = 'Push Codelab';
    const options = {
        body: evt.data.text(),
        icon: 'images/icon.png',
        badge: 'images/badge.png'
    };

    evt.waitUntil(self.registration.showNotification(title, options));

});