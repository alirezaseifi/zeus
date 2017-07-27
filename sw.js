self.addEventListener('push', evt => {

    const { body, url } = JSON.parse(evt.data.text());

    evt.waitUntil(self.registration.showNotification('ZEUS', {
        body,
        data: { url }
    }));

});

self.addEventListener('notificationclick', evt => evt.waitUntil(clients.openWindow(evt.notification.data.url)));