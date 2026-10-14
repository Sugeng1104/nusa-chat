// PASURA Chat V17: background push for Android Chromium.
// This is a module service worker, using the existing public Firebase config.
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getMessaging,onBackgroundMessage} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-sw.js';
import {firebaseConfig} from './js/firebase-config.js';
const app=initializeApp(firebaseConfig);
const messaging=getMessaging(app);
onBackgroundMessage(messaging,payload=>{
  // The backend sends data-only messages; the service worker shows the notification.
  const data=payload.data||{};
  const isCall=data.type==='call';
  const title=isCall?'📞 Panggilan masuk • PASURA Chat':'💬 Pesan baru • PASURA Chat';
  const body=isCall?(data.kind==='video'?'Ada panggilan video masuk':'Ada panggilan suara masuk'):'Anda menerima pesan baru';
  const url=new URL('chat.html',self.registration.scope).href;
  return self.registration.showNotification(title,{
    body,icon:new URL('icons/pasura-logo.png',self.registration.scope).href,
    badge:new URL('icons/pasura-logo.png',self.registration.scope).href,
    tag:isCall?'pasura-call-'+(data.callId||'incoming'):'pasura-message-'+(data.chatId||'new'),
    data:{url,callId:data.callId||''},
    renotify:isCall
  });
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=event.notification.data?.url||new URL('chat.html',self.registration.scope).href;
  event.waitUntil((async()=>{
    const clientsList=await clients.matchAll({type:'window',includeUncontrolled:true});
    for(const c of clientsList){if(c.url.startsWith(self.registration.scope)){await c.focus();return;}}
    await clients.openWindow(url);
  })());
});
