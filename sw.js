self.addEventListener('push', evt => {
    console.log('[Service Worker] Push Received.');
    console.log(`[Service Worker] Push had this data: "${evt.data.text()}"`);

    const title = 'Push Codelab';
    const options = {
        body: 'Yay it works.',
        icon: 'images/icon.png',
        badge: 'images/badge.png'
    };

    evt.waitUntil(self.registration.showNotification(title, options));
});