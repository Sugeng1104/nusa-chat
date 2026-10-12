import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getAuth,onAuthStateChanged,signOut,reload} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {getFirestore,doc,getDoc,collection,query,where,getDocs,onSnapshot,orderBy,limit,serverTimestamp,setDoc,addDoc,updateDoc} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {firebaseConfig} from './firebase-config.js';
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
const $=id=>document.getElementById(id);
let self=null,contacts=[],groups=[],peer=null,stopMessages=null,stopConversations=null,stopGroups=null,unread=new Set(),lastSeen={},watchers=new Map(),groupWatchers=new Map(),openedAt=0,selectionToken=0,existingPrivate=new Set(),hasMessages=new Set();
// Notifikasi otomatis selama halaman NUSA CHAT masih berjalan.
const notifyStartedAt=Date.now();
let audioCtx=null;
let soundOn=localStorage.getItem('nusa-chat-sound')!=='off';
const soundBtn=$('soundToggle'),notifyBtn=$('enableNotify');
function drawSound(){soundBtn.textContent=soundOn?'🔊 Suara ON':'🔇 Suara OFF';soundBtn.setAttribute('aria-pressed',String(soundOn));}
drawSound();
function unlockAudio(){try{const A=window.AudioContext||window.webkitAudioContext;if(!A)return;if(!audioCtx)audioCtx=new A();if(audioCtx.state==='suspended')audioCtx.resume().catch(()=>{});}catch(e){console.warn('Audio tidak tersedia',e);}}
window.addEventListener('pointerdown',unlockAudio,{passive:true});
window.addEventListener('keydown',unlockAudio);
soundBtn.addEventListener('click',()=>{soundOn=!soundOn;localStorage.setItem('nusa-chat-sound',soundOn?'on':'off');drawSound();if(soundOn)playSound();});
function playSound(){if(!soundOn)return;try{unlockAudio();if(!audioCtx||audioCtx.state!=='running')return;const t=audioCtx.currentTime;for(const [delay,freq] of [[0,740],[.15,990]]){const osc=audioCtx.createOscillator(),gain=audioCtx.createGain();osc.type='sine';osc.frequency.value=freq;gain.gain.setValueAtTime(.0001,t+delay);gain.gain.exponentialRampToValueAtTime(.07,t+delay+.015);gain.gain.exponentialRampToValueAtTime(.0001,t+delay+.13);osc.connect(gain);gain.connect(audioCtx.destination);osc.start(t+delay);osc.stop(t+delay+.14);}}catch(e){console.warn('Bunyi notifikasi dibatasi browser',e);}}
function drawNotifyPermission(){if(!('Notification'in window)){notifyBtn.textContent='🔕 Tidak didukung';notifyBtn.disabled=true;return;}const p=Notification.permission;notifyBtn.textContent=p==='granted'?'🔔 Aktif':p==='denied'?'🔕 Diblokir':'🔔 Aktifkan';notifyBtn.title=p==='denied'?'Izinkan notifikasi melalui pengaturan situs browser':'Izin notifikasi sistem';}
drawNotifyPermission();
notifyBtn.addEventListener('click',async()=>{unlockAudio();if(!('Notification'in window))return;try{if(Notification.permission==='default')await Notification.requestPermission();drawNotifyPermission();}catch(e){console.warn('Izin notifikasi gagal',e);}});
const alerted=new Map();
function incomingAlert(key,message,stamp){if(stamp<=notifyStartedAt||message.senderId===self?.uid)return;const last=alerted.get(key)||0;if(stamp<=last)return;alerted.set(key,stamp);playSound();if(document.visibilityState!=='visible'&&'Notification'in window&&Notification.permission==='granted'){try{const n=new Notification('Pesan baru • NUSA CHAT',{body:'Anda menerima pesan baru',tag:'nusa-chat-'+key,icon:'icons/asn-3d.png'});n.onclick=()=>{window.focus();n.close();};}catch(e){console.warn('Notifikasi sistem dibatasi browser',e);}}}
const mobileLayout=document.querySelector('.chat-layout');
const mobileBack=$('mobileBack');
function openMobileChat(){mobileLayout.classList.add('mobile-open');if(window.innerWidth<=680&&!history.state?.nusaChat){history.pushState({nusaChat:true},'',location.href);}}
function closeMobileChat(){mobileLayout.classList.remove('mobile-open');$('messageText').blur();}
mobileBack.addEventListener('click',()=>{if(history.state?.nusaChat)history.back();else closeMobileChat();});
window.addEventListener('popstate',()=>closeMobileChat());
const status=t=>{$('chatStatus').textContent=t||'';};
const base=location.pathname.substring(0,location.pathname.lastIndexOf('/')+1);
const back=()=>location.replace(base+'login.html');
$('logout').addEventListener('click',async()=>{window.dispatchEvent(new Event('nusa:logout'));if(stopMessages)stopMessages();if(stopConversations)stopConversations();if(stopGroups)stopGroups();for(const stop of watchers.values())stop();await signOut(auth);back();});
function schoolLabel(u){return u.orgName || u.orgId || 'Instansi belum tersedia';}
function contactLabel(u){return u.name+' · '+schoolLabel(u);}
const hiddenChats=new Map();
let deleteTarget=null;
function hiddenStorageKey(){return 'nusa-chat-hidden-'+self.uid;}
function loadHidden(){try{const data=JSON.parse(localStorage.getItem(hiddenStorageKey())||'{}');for(const [k,v] of Object.entries(data)){if(Number.isFinite(v))hiddenChats.set(k,v);}}catch(e){console.warn('Tidak dapat memuat arsip chat',e);}}
function saveHidden(){localStorage.setItem(hiddenStorageKey(),JSON.stringify(Object.fromEntries(hiddenChats)));}
function isHidden(key){return hiddenChats.has(key);}
function requestHide(key,label){
 deleteTarget={key,label};
 $('deleteChatDescription').textContent='Sembunyikan percakapan dengan '+label+' dari daftar chat pada perangkat ini? Riwayat pesan tetap tersimpan di Firebase dan tidak terhapus dari akun lain. Pesan baru akan menampilkan chat kembali.';
 $('deleteChatDialog').showModal();
}
$('cancelDeleteChat').addEventListener('click',()=>$('deleteChatDialog').close());
$('confirmDeleteChat').addEventListener('click',()=>{
 if(!deleteTarget||!self)return;
 const {key}=deleteTarget;
 // The timestamp is a cutoff for messages that should no longer show in the list.
 hiddenChats.set(key,Date.now());saveHidden();unread.delete(key);
 if(peer && (peer.kind==='group'?'g:'+peer.id:'p:'+conversationId(self.uid,peer.uid))===key){
  if(stopMessages){stopMessages();stopMessages=null;}
  peer=null;window.dispatchEvent(new CustomEvent('nusa:peer',{detail:null}));$('addGroupMember').hidden=true;selectionToken++;$('chatWith').textContent='Pilih kontak untuk mulai percakapan';
  $('messages').replaceChildren();$('messageText').value='';$('messageText').disabled=true;
  $('sendMessage').disabled=true;emojiToggle.disabled=true;setEmojiOpen(false);
  if(history.state?.nusaChat)history.back();else closeMobileChat();
 }
 $('deleteChatDialog').close();deleteTarget=null;drawContacts();drawGroups();drawNotice();
});
function deleteControl(key,label){
 const b=document.createElement('button');b.type='button';b.className='delete-chat';b.textContent='🗑';b.title='Hapus chat dari daftar';b.setAttribute('aria-label','Hapus chat '+label);
 b.addEventListener('click',e=>{e.stopPropagation();requestHide(key,label);});return b;
}
// Tekan dan tahan 1 detik pada daftar chat atau pesan.
const localHistory={};
let actionTarget=null;
function historyStorageKey(){return 'nusa-chat-history-'+self.uid;}
function loadHistory(){try{Object.assign(localHistory,JSON.parse(localStorage.getItem(historyStorageKey())||'{}'));}catch(e){console.warn('Riwayat lokal tidak dapat dibaca',e);}}
function persistHistory(){localStorage.setItem(historyStorageKey(),JSON.stringify(localHistory));}
function historyFor(key){return localHistory[key]??{cutoff:0,ids:[]};}
function currentKey(){return !peer?null:(peer.kind==='group'?'g:'+peer.id:'p:'+conversationId(self.uid,peer.uid));}
function longPress(el,callback){
 let timer=null,started=false,sx=0,sy=0,suppress=false;
 const clear=()=>{if(timer!==null){clearTimeout(timer);timer=null;}};
 el.addEventListener('pointerdown',e=>{
  if(e.button!==0||e.target.closest('input,textarea'))return;
  sx=e.clientX;sy=e.clientY;started=true;
  clear();timer=setTimeout(()=>{timer=null;suppress=true;callback();},1000);
 });
 el.addEventListener('pointermove',e=>{if(started&&(Math.abs(e.clientX-sx)>12||Math.abs(e.clientY-sy)>12))clear();});
 ['pointerup','pointercancel','pointerleave'].forEach(type=>el.addEventListener(type,()=>{clear();started=false;}));
 el.addEventListener('click',e=>{if(suppress){e.preventDefault();e.stopImmediatePropagation();suppress=false;}},true);
 el.addEventListener('contextmenu',e=>{e.preventDefault();clear();suppress=true;callback();});
 el.addEventListener('keydown',e=>{if(e.key==='F10'&&e.shiftKey){e.preventDefault();callback();}});
}
function openActions(target){
 actionTarget=target;
 const isMessage=target.type==='message';
 $('actionTitle').textContent=isMessage?'Pilihan Pesan':'Pilihan Percakapan';
 $('actionDescription').textContent=isMessage
  ?'Sembunyikan pesan ini hanya untuk Anda pada perangkat ini. Pesan tidak terhapus dari Firebase.'
  :'Hapus chat dari daftar atau kosongkan riwayat obrolan pada perangkat ini. Pesan tetap ada di Firebase dan pada akun lawan bicara.';
 $('actionDelete').textContent=isMessage?'Hapus Pesan untuk Saya':'Hapus Chat dari Daftar';
 $('actionClear').hidden=isMessage;
 $('actionDialog').showModal();
}
$('actionCancel').addEventListener('click',()=>$('actionDialog').close());
$('actionDelete').addEventListener('click',()=>{
 if(!actionTarget)return;
 const t=actionTarget;
 $('actionDialog').close();
 if(t.type==='message'){
  const state=historyFor(t.key);state.ids=[...new Set([...state.ids,t.id])];localHistory[t.key]=state;persistHistory();
  const bubble=document.querySelector('[data-message-id="'+CSS.escape(t.id)+'"]');if(bubble)bubble.remove();
 }else{requestHide(t.key,t.label);}
 actionTarget=null;
});
$('actionClear').addEventListener('click',()=>{
 if(!actionTarget||actionTarget.type!=='chat')return;
 const t=actionTarget;
 if(!confirm('Kosongkan riwayat obrolan dengan '+t.label+' hanya di perangkat ini?'))return;
 const state=historyFor(t.key);state.cutoff=Date.now();state.ids=[];localHistory[t.key]=state;persistHistory();
 $('actionDialog').close();actionTarget=null;
 if(currentKey()===t.key){$('messages').replaceChildren();const p=document.createElement('p');p.className='chat-empty';p.textContent='Riwayat obrolan dikosongkan pada perangkat ini.';$('messages').append(p);}
 drawContacts();drawGroups();
});
function seenKey(id){return 'nusa-chat-seen-'+self.uid+'-'+id;}
function markSeen(id){const t=Date.now();lastSeen[id]=t;localStorage.setItem(seenKey(id),String(t));unread.delete(id);drawContacts();drawGroups();drawNotice();}
function drawNotice(){const n=unread.size;$('notificationSummary').textContent=n?`🔔 ${n} percakapan memiliki pesan baru`:'Tidak ada pesan baru';document.title=n?`(${n}) Percakapan | NUSA CHAT`:'Percakapan | NUSA CHAT';}
function drawContacts(){const search=$('contactSearch').value.trim().toLowerCase();const list=$('contacts');list.replaceChildren();const found=contacts.filter(u=>hasMessages.has('p:'+conversationId(self.uid,u.uid))&&!isHidden('p:'+conversationId(self.uid,u.uid))&&contactLabel(u).toLowerCase().includes(search));if(!found.length){list.textContent='Belum ada percakapan pribadi. Tekan tombol pesan baru untuk memulai.';return;}for(const u of found){const id=conversationId(self.uid,u.uid);const b=document.createElement('button');b.type='button';b.className='contact'+(peer?.kind==='private'&&peer.uid===u.uid?' selected':'');const name=document.createElement('strong');name.textContent=u.name;const org=document.createElement('small');org.textContent=schoolLabel(u);b.append(name,org);if(unread.has('p:'+id)){const mark=document.createElement('span');mark.className='unread-mark';mark.textContent='!';mark.title='Pesan baru';b.append(mark);}b.addEventListener('click',()=>selectPeer(u));const row=document.createElement('div');row.className='chat-entry';row.append(b);longPress(row,()=>openActions({type:'chat',key:'p:'+id,label:u.name}));list.append(row);}}
function drawGroups(){const list=$('groups');list.replaceChildren();const search=$('contactSearch').value.trim().toLowerCase();const found=groups.filter(g=>!isHidden('g:'+g.id)&&g.name.toLowerCase().includes(search));if(!found.length){list.textContent='Belum ada grup.';return;}for(const g of found){const b=document.createElement('button');b.type='button';b.className='contact'+(peer?.kind==='group'&&peer.id===g.id?' selected':'');const name=document.createElement('strong');name.textContent='👥 '+g.name;const sub=document.createElement('small');sub.textContent=g.members.length+' anggota';b.append(name,sub);if(unread.has('g:'+g.id)){const mark=document.createElement('span');mark.className='unread-mark';mark.textContent='!';mark.title='Pesan baru';b.append(mark);}b.addEventListener('click',()=>selectGroup(g));const row=document.createElement('div');row.className='chat-entry';row.append(b);longPress(row,()=>openActions({type:'chat',key:'g:'+g.id,label:g.name}));list.append(row);}}
function monitorMessages(key,ref,collectionPath,kind){if(watchers.has(key))return;const unsubscribe=onSnapshot(query(collection(ref,'messages'),orderBy('createdAt','desc'),limit(1)),snap=>{if(snap.empty){if(hasMessages.delete(key))drawContacts();return;}if(!hasMessages.has(key)){hasMessages.add(key);drawContacts();}const msg=snap.docs[0].data(),time=msg.createdAt?.toMillis?.();if(time&&msg.senderId!==self.uid)incomingAlert(key,msg,time);if(isHidden(key)&&time&&time>hiddenChats.get(key)&&msg.senderId!==self.uid){hiddenChats.delete(key);saveHidden();drawContacts();drawGroups();}if(isHidden(key))return;if(!time||msg.senderId===self.uid)return;const stored=lastSeen[key]??Number(localStorage.getItem(seenKey(key))||0);if(time>stored&&!(peer?.kind===kind&&((kind==='private'&&'p:'+conversationId(self.uid,peer.uid)===key)||(kind==='group'&&'g:'+peer.id===key))&&document.visibilityState==='visible')){unread.add(key);drawContacts();drawGroups();drawNotice();}else if(time>stored&&peer&&document.visibilityState==='visible'){markSeen(key);}},e=>{console.warn('Notifikasi tidak tersedia:',key,e.code);});watchers.set(key,unsubscribe);}
function watchPrivate(){if(stopConversations)stopConversations();stopConversations=onSnapshot(query(collection(db,'conversations'),where('participants','array-contains',self.uid)),snap=>{const valid=new Set();for(const d of snap.docs){const v=d.data();if(!Array.isArray(v.participants)||v.participants.length!==2)continue;const key='p:'+d.id;valid.add(key);monitorMessages(key,d.ref,null,'private');}for(const [k,stop] of watchers){if(k.startsWith('p:')&&!valid.has(k)){stop();watchers.delete(k);unread.delete(k);hasMessages.delete(k);}}drawContacts();drawNotice();},e=>status('Notifikasi pribadi gagal: '+e.message));}
function watchGroups(){if(stopGroups)stopGroups();stopGroups=onSnapshot(query(collection(db,'groups'),where('members','array-contains',self.uid)),snap=>{groups=snap.docs.map(d=>({id:d.id,...d.data()}));if(peer?.kind==='group'){const latest=groups.find(g=>g.id===peer.id);if(latest)peer={...latest,kind:'group'};}const valid=new Set();for(const d of snap.docs){const key='g:'+d.id;valid.add(key);monitorMessages(key,d.ref,null,'group');}for(const [k,stop] of watchers){if(k.startsWith('g:')&&!valid.has(k)){stop();watchers.delete(k);unread.delete(k);hasMessages.delete(k);}}drawGroups();drawNotice();},e=>status('Gagal memuat grup: '+e.message));}
// PASURA Google Drive bridge: cross-origin transport via Apps Script HTML Service.
const DRIVE_API='https://script.google.com/macros/s/AKfycbwmJeQraBC2aph41UnxgRRhOn-kHwV-XeSkHOc1CsFuiixjSucbTNtn4uAOFTJgf_M/exec';
const DRIVE_MAX=10*1024*1024;
const DRIVE_EXT=new Set(['pdf','docx','xlsx','ppt','jpg','jpeg','png','gif']);
// V5: request/response handshake through a dedicated Apps Script popup.
// The popup must be opened synchronously from a user click (before awaits).
let selectedFile=null;
function openDriveBridge(){
 const nonce=crypto.randomUUID();
 const url=DRIVE_API+'?bridge=1&nonce='+encodeURIComponent(nonce);
 const popup=window.open(url,'pasura_drive_'+nonce,'popup=yes,width=420,height=360');
 if(!popup)throw Error('Jendela penghubung diblokir. Izinkan pop-up untuk situs PASURA Chat.');
 // Upayakan fokus tetap pada ruang chat. Browser dapat mengabaikan permintaan ini.
 try{popup.blur();window.focus();}catch(e){}
 return {popup,nonce};
}
function trustedBridgeOrigin(origin){
 try{const u=new URL(origin);return u.protocol==='https:' && (u.hostname==='script.google.com'||u.hostname==='script.googleusercontent.com'||u.hostname.endsWith('.googleusercontent.com'));}catch{return false;}
}
async function driveRequest(request,bridge){
 if(!bridge)throw Error('Jendela Google Drive belum dibuka.');
 const {popup,nonce}=bridge;
 const user=auth.currentUser;if(!user){popup.close();throw Error('Silakan masuk kembali.');}
 request.idToken=await user.getIdToken();
 const id=crypto.randomUUID();
 return await new Promise((resolve,reject)=>{
  let completed=false,receivedReady=false;
  const cleanup=()=>{completed=true;clearTimeout(timer);clearInterval(check);window.removeEventListener('message',onMessage);try{popup.close();}catch{}};
  const fail=message=>{if(completed)return;cleanup();reject(Error(message));};
  const timer=setTimeout(()=>fail(receivedReady?'Google Drive tidak menyelesaikan permintaan dalam 90 detik.':'Jendela penghubung Google Drive tidak siap. Periksa deployment Bridge.html dan izin pop-up.'),90000);
  const check=setInterval(()=>{if(popup.closed)fail('Jendela penghubung ditutup sebelum selesai.');},800);
  function onMessage(event){
   const data=event.data;
   if(!trustedBridgeOrigin(event.origin)||!data||data.pasuraDrive!==true||data.nonce!==nonce)return;
   if(data.type==='ready'){
    receivedReady=true;
    if(!event.source)return fail('Jendela Google Drive tidak menyediakan saluran komunikasi.');
    event.source.postMessage({pasuraDrive:true,type:'request',nonce,id,request},event.origin);
   }else if(data.type==='result'&&data.id===id){
    cleanup();if(!data.result?.ok)reject(Error(data.result?.error||'Google Drive menolak permintaan.'));
    else resolve(data.result.file);
   }
  }
  window.addEventListener('message',onMessage);
 });
}
function clearAttachment(){selectedFile=null;$('attachmentFile').value='';$('attachmentPreview').hidden=true;$('attachmentPreview').replaceChildren();}
// Label HTML native membuka file picker tanpa bergantung pada eksekusi JavaScript.
$('attachToggle').addEventListener('click',()=>{
 if(!self){status('Akun belum siap. Tunggu hingga login selesai.');}
 else if(!peer){status('Pilih kontak atau grup sebelum mengirim lampiran.');}
});
$('attachToggle').addEventListener('keydown',e=>{
 if(e.key==='Enter'||e.key===' '){e.preventDefault();$('attachmentFile').click();}
});
$('attachmentFile').addEventListener('change',()=>{
 const file=$('attachmentFile').files?.[0];if(!file){return;}
 const ext=file.name.split('.').pop().toLowerCase();
 if(!DRIVE_EXT.has(ext)||file.size>DRIVE_MAX||file.size===0){status('Format tidak didukung atau file melebihi 10 MB.');clearAttachment();return;}
 selectedFile=file;status('Lampiran dipilih: '+file.name+'. Tekan Kirim untuk mengunggah.');const preview=$('attachmentPreview');preview.replaceChildren();preview.hidden=false;
 const name=document.createElement('span');name.textContent='📎 '+file.name+' ('+(file.size/1024/1024).toFixed(2)+' MB)';
 const remove=document.createElement('button');remove.type='button';remove.textContent='✕';remove.title='Batalkan lampiran';remove.addEventListener('click',clearAttachment);preview.append(name,remove);
});
function fileAsBase64(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('File tidak dapat dibaca.'));r.readAsDataURL(file);});}
function renderDriveAttachment(box,m){
 const f=m.attachment;if(!f||!f.id)return;
 const wrap=document.createElement('div');wrap.className='nc-file-bubble';
 const btn=document.createElement('button');btn.type='button';btn.textContent='📎 '+(f.name||'Lampiran')+' · Unduh';btn.style.width='auto';
 btn.addEventListener('click',async e=>{
  e.stopPropagation();btn.disabled=true;const label=btn.textContent;btn.textContent='Mengunduh...';
  try{const bridge=openDriveBridge();const data=await driveRequest({action:'download',fileId:f.id,conversationId:f.conversationId},bridge);
   const raw=atob(data.base64);const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
   const url=URL.createObjectURL(new Blob([bytes],{type:data.mimeType||'application/octet-stream'}));
   const a=document.createElement('a');a.href=url;a.download=data.name||'lampiran';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }catch(err){status('Unduhan gagal: '+err.message);}finally{btn.disabled=false;btn.textContent=label;}
 });wrap.append(btn);box.append(wrap);
}
// Moderasi tautan PASURA Chat V15: whitelist domain menggunakan hostname, bukan substring.
const PASURA_URL_RE=/https?:\/\/[^\s<>"'`]+/gi;
function pasuraLinks(text){return [...String(text||'').matchAll(PASURA_URL_RE)].map(m=>m[0].replace(/[),.;!?]+$/,''));}
function pasuraTrusted(url){try{const u=new URL(url);const h=u.hostname.toLowerCase();return u.protocol==='https:'&&['kemendikdasmen.go.id','belajar.id'].some(d=>h===d||h.endsWith('.'+d));}catch{return false;}}
const pasuraReviews=new Map();let pasuraReviewStop=null;
function pasuraWatchReviews(){if(pasuraReviewStop)pasuraReviewStop();pasuraReviewStop=onSnapshot(query(collection(db,'linkReviews'),where('senderId','==',self.uid)),snap=>{for(const d of snap.docs)pasuraReviews.set(d.id,d.data());if(peer){const k=peer.kind==='group'?'g:'+peer.id:'p:'+conversationId(self.uid,peer.uid);if(window.pasuraLastMessageSnap)showMessages(window.pasuraLastMessageSnap,k);}},()=>{});}
function pasuraRenderLinks(box,m,messageId){const urls=pasuraLinks(m.text);if(!urls.length)return;const wrap=document.createElement('div');wrap.style.cssText='margin-top:8px;display:flex;flex-direction:column;gap:6px';for(const url of urls){const row=document.createElement('div');const trusted=pasuraTrusted(url);const review=pasuraReviews.get(messageId);const approved=trusted||review?.reviewStatus==='approved';if(approved){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='🔗 Buka tautan: '+url;a.style.overflowWrap='anywhere';row.append(a);}else{row.textContent=(review?.reviewStatus==='rejected'?'⛔ Link ditolak admin: ':'⏳ Menunggu persetujuan admin: ')+url;row.style.cssText='font-size:12px;overflow-wrap:anywhere;opacity:.85';}wrap.append(row);}box.append(wrap);}
function showMessages(snap,key){window.pasuraLastMessageSnap=snap;const area=$('messages');area.replaceChildren();if(snap.empty){const p=document.createElement('p');p.className='chat-empty';p.textContent='Belum ada pesan. Mulai percakapan!';area.append(p);return;}for(const d of snap.docs){const m=d.data();const hs=historyFor(key);if(hs.ids.includes(d.id)||(m.createdAt?.toMillis?.()||0)<=hs.cutoff)continue;const box=document.createElement('div');box.className='bubble'+(m.senderId===self.uid?' mine':'');box.textContent=m.text;pasuraRenderLinks(box,m,d.id);renderDriveAttachment(box,m);box.dataset.messageId=d.id;box.tabIndex=0;box.title='Tekan dan tahan 1 detik untuk pilihan hapus';longPress(box,()=>openActions({type:'message',key,id:d.id}));const time=document.createElement('time');time.textContent=m.createdAt?.toDate?.().toLocaleString('id-ID',{dateStyle:'short',timeStyle:'short'})||'Mengirim...';box.append(time);area.append(box);}area.scrollTop=area.scrollHeight;}
function conversationId(a,b){return [a,b].sort().join('_');}
// V16: setiap pesan yang mengandung link dipantau melalui dokumen review-nya.
// Query koleksi berdasarkan chatId dapat ditolak Firestore Rules karena cakupan query;
// listener dokumen spesifik memastikan pengirim dan peserta percakapan melihat status yang sama.
const pasuraMessageReviewStops=new Map();
let pasuraCurrentReviewChat=null;
function pasuraStopMessageReviews(){
  for(const stop of pasuraMessageReviewStops.values())stop();
  pasuraMessageReviewStops.clear();
  pasuraCurrentReviewChat=null;
}
function pasuraTrackMessageReviews(snap,key){
  const ids=new Set(snap.docs.filter(d=>pasuraLinks(d.data().text).some(url=>!pasuraTrusted(url))).map(d=>d.id));
  for(const [id,stop] of pasuraMessageReviewStops){if(!ids.has(id)){stop();pasuraMessageReviewStops.delete(id);pasuraReviews.delete(id);}}
  for(const id of ids){
    if(pasuraMessageReviewStops.has(id))continue;
    const stop=onSnapshot(doc(db,'linkReviews',id),reviewSnap=>{
      if(pasuraCurrentReviewChat!==key)return;
      if(reviewSnap.exists())pasuraReviews.set(id,reviewSnap.data());
      else pasuraReviews.delete(id);
      if(window.pasuraLastMessageSnap)showMessages(window.pasuraLastMessageSnap,key);
    },err=>console.warn('Gagal membaca status persetujuan link '+id+':',err.message));
    pasuraMessageReviewStops.set(id,stop);
  }
}
function startMessages(ref,key){
  pasuraStopMessageReviews();
  pasuraCurrentReviewChat=key;
  window.pasuraLastMessageSnap=null;
  stopMessages=onSnapshot(query(collection(ref,'messages'),orderBy('createdAt','desc'),limit(100)),s=>{
    const visible={docs:[...s.docs].reverse(),empty:s.empty};
    showMessages(visible,key);
    pasuraTrackMessageReviews(visible,key);
    if(document.visibilityState==='visible')markSeen(key);
  },e=>status('Gagal membaca pesan: '+e.message));
}
async function selectPeer(u){const keyForUnhide='p:'+conversationId(self.uid,u.uid);if(isHidden(keyForUnhide)){hiddenChats.delete(keyForUnhide);saveHidden();}openMobileChat();const token=++selectionToken;if(stopMessages){stopMessages();stopMessages=null;}pasuraStopMessageReviews();peer={...u,kind:'private'};window.dispatchEvent(new CustomEvent('nusa:peer',{detail:{kind:'private',uid:u.uid,name:u.name}}));$('addGroupMember').hidden=true;clearAttachment();setEmojiOpen(false);emojiToggle.disabled=false;drawContacts();drawGroups();$('chatWith').textContent=u.name+' · '+schoolLabel(u);$('messageText').disabled=false;$('sendMessage').disabled=false;status('');const id=conversationId(self.uid,u.uid),key='p:'+id,ref=doc(db,'conversations',id);try{const existing=await getDoc(ref);if(!existing.exists())await setDoc(ref,{participants:[self.uid,u.uid].sort(),createdAt:serverTimestamp()});if(token!==selectionToken)return;markSeen(key);startMessages(ref,key);}catch(e){status('Tidak dapat membuka percakapan: '+e.message);}}
async function selectGroup(g){const keyForUnhide='g:'+g.id;if(isHidden(keyForUnhide)){hiddenChats.delete(keyForUnhide);saveHidden();}openMobileChat();++selectionToken;if(stopMessages){stopMessages();stopMessages=null;}pasuraStopMessageReviews();peer={...g,kind:'group'};window.dispatchEvent(new CustomEvent('nusa:peer',{detail:{kind:'group'}}));$('addGroupMember').hidden=false;clearAttachment();setEmojiOpen(false);emojiToggle.disabled=false;drawContacts();drawGroups();$('chatWith').textContent='👥 '+g.name;$('messageText').disabled=false;$('sendMessage').disabled=false;status('');const key='g:'+g.id;markSeen(key);startMessages(doc(db,'groups',g.id),key);}

// Penambahan anggota ke grup yang sedang dibuka.
function renderAddMembers(){
 const list=$('addMemberList');list.replaceChildren();
 if(!peer||peer.kind!=='group')return;
 const q=$('addMemberSearch').value.trim().toLocaleLowerCase('id');
 const existing=new Set(peer.members||[]);
 const candidates=contacts.filter(u=>!existing.has(u.uid)&&contactLabel(u).toLocaleLowerCase('id').includes(q)).sort((a,b)=>a.name.localeCompare(b.name,'id'));
 if(!candidates.length){const p=document.createElement('p');p.textContent='Tidak ada pengguna aktif lain yang cocok.';list.append(p);return;}
 for(const u of candidates){const label=document.createElement('label'),cb=document.createElement('input'),span=document.createElement('span');cb.type='checkbox';cb.value=u.uid;span.textContent=contactLabel(u);label.append(cb,span);list.append(label);}
}
$('addGroupMember').addEventListener('click',()=>{
 if(!peer||peer.kind!=='group')return;
 $('addMemberGroupName').textContent='Grup: '+peer.name;
 $('addMemberSearch').value='';renderAddMembers();$('addMemberDialog').showModal();
});
$('addMemberSearch').addEventListener('input',renderAddMembers);
$('cancelAddMember').addEventListener('click',()=>$('addMemberDialog').close());
$('addMemberForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!peer||peer.kind!=='group'||!self)return;
 const ids=[...$('addMemberList').querySelectorAll('input:checked')].map(el=>el.value);
 if(!ids.length){status('Pilih setidaknya satu pengguna untuk ditambahkan.');return;}
 if(ids.length>1){status('Untuk pengujian ini, pilih 1 anggota baru saja.');return;}
 const btn=$('submitAddMember');btn.disabled=true;
 const groupId=peer.id;
 let stage='membaca data grup';
 try{
  const ref=doc(db,'groups',groupId);
  const latest=await getDoc(ref);
  if(!latest.exists())throw Error('Dokumen grup tidak ditemukan.');
  const oldMembers=latest.data().members;
  if(!Array.isArray(oldMembers)||!oldMembers.includes(self.uid))throw Error('Akun ini bukan anggota grup.');
  const approved=ids.filter(id=>contacts.some(u=>u.uid===id)&&!oldMembers.includes(id));
  if(!approved.length)throw Error('Semua pengguna terpilih sudah menjadi anggota.');
  if(oldMembers.length+approved.length>20)throw Error('Grup maksimal 20 anggota.');
  // Kirim array utuh dengan satu UID di akhir agar sesuai Rules V3.
  const nextMembers=[...oldMembers,approved[0]];
  stage='menyimpan anggota baru (updateDoc)';
  console.info('[NUSA CHAT] Tambah anggota:',{groupId,uid:self.uid,oldCount:oldMembers.length,newCount:nextMembers.length,stage});
  await updateDoc(ref,{members:nextMembers});
  if(peer?.kind==='group'&&peer.id===groupId)peer.members=nextMembers;
  $('addMemberDialog').close();status('1 anggota berhasil ditambahkan ke grup.');
 }catch(err){
  console.error('[NUSA CHAT] Gagal pada tahap:',stage,err);
  status('Gagal pada tahap '+stage+' ('+(err.code||'unknown')+'): '+err.message);
 }finally{btn.disabled=false;}
});

document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&peer){const key=peer.kind==='group'?'g:'+peer.id:'p:'+conversationId(self.uid,peer.uid);markSeen(key);}});

function renderNewMessageList(){
 const q=$('newMessageSearch').value.trim().toLowerCase(),list=$('newMessageList');list.replaceChildren();
 const found=contacts.filter(u=>contactLabel(u).toLowerCase().includes(q)).sort((a,b)=>a.name.localeCompare(b.name,'id'));
 if(!found.length){list.textContent='Tidak ada pengguna aktif yang cocok.';return;}
 for(const u of found){const b=document.createElement('button');b.type='button';b.className='contact';
  const n=document.createElement('strong');n.textContent=u.name;const org=document.createElement('small');org.textContent=schoolLabel(u);b.append(n,org);
  b.addEventListener('click',()=>{$('newMessageDialog').close();selectPeer(u);});list.append(b);}
}
$('newMessage').addEventListener('click',()=>{renderNewMessageList();$('newMessageDialog').showModal();$('newMessageSearch').focus();});
$('closeNewMessage').addEventListener('click',()=>$('newMessageDialog').close());
$('newMessageSearch').addEventListener('input',renderNewMessageList);

$('createGroup').addEventListener('click',()=>{const list=$('groupMembers');list.replaceChildren();for(const u of contacts){const label=document.createElement('label'),cb=document.createElement('input'),span=document.createElement('span');cb.type='checkbox';cb.value=u.uid;span.textContent=u.name+' · '+schoolLabel(u);label.append(cb,span);list.append(label);}$('groupDialog').showModal();});
$('cancelGroup').addEventListener('click',()=>$('groupDialog').close());
$('groupForm').addEventListener('submit',async e=>{e.preventDefault();const name=$('groupName').value.trim(),selected=[...$('groupMembers').querySelectorAll('input:checked')].map(x=>x.value),members=[self.uid,...selected].sort();if(name.length<3||members.length<2){status('Nama grup minimal 3 karakter dan pilih setidaknya 1 anggota.');return;}const btn=e.submitter;btn.disabled=true;try{await addDoc(collection(db,'groups'),{name,members,createdBy:self.uid,createdAt:serverTimestamp()});$('groupDialog').close();$('groupForm').reset();status('Grup berhasil dibuat.');}catch(err){status('Gagal membuat grup: '+err.message);}finally{btn.disabled=false;}});
// Pemilih emoji lokal: tanpa API, library, atau izin tambahan.
const EMOJIS=['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😍','🥰','😘','😎','🤩','🥳','😇','🙂','🙃','😉','😌','😋','😜','🤗','🤔','🥹','😢','😭','😴','😮','😱','😡','👍','👎','👏','🙌','🙏','🤝','💪','👋','👌','✌️','🤞','❤️','🧡','💛','💚','💙','💜','💕','💖','💯','🔥','✨','🎉','🎂','🎁','🌹','🌸','🌻','☀️','🌈','⭐','☕','🍕','🍉','🐱','🐶','🚀','💬','📚','✅'];
const emojiToggle=$('emojiToggle'),emojiPicker=$('emojiPicker'),messageInput=$('messageText');
const setEmojiOpen=open=>{emojiPicker.hidden=!open;emojiToggle.setAttribute('aria-expanded',String(open));};
const pickerTitle=document.createElement('div');pickerTitle.className='emoji-picker-title';pickerTitle.textContent='Pilih emoji';emojiPicker.append(pickerTitle);
for(const emoji of EMOJIS){const b=document.createElement('button');b.type='button';b.className='emoji-choice';b.textContent=emoji;b.setAttribute('aria-label','Masukkan emoji '+emoji);b.addEventListener('click',()=>{if(messageInput.disabled)return;const start=messageInput.selectionStart??messageInput.value.length;const end=messageInput.selectionEnd??start;const updated=messageInput.value.slice(0,start)+emoji+messageInput.value.slice(end);if(updated.length>2000){status('Pesan maksimal 2000 karakter.');return;}messageInput.value=updated;messageInput.focus();messageInput.setSelectionRange(start+emoji.length,start+emoji.length);setEmojiOpen(false);});emojiPicker.append(b);}
emojiToggle.addEventListener('click',()=>{if(!emojiToggle.disabled)setEmojiOpen(emojiPicker.hidden);});
document.addEventListener('click',e=>{if(!e.target.closest('.emoji-wrap'))setEmojiOpen(false);});
document.addEventListener('keydown',e=>{if(e.key==='Escape')setEmojiOpen(false);});
$('contactSearch').addEventListener('input',()=>{drawContacts();drawGroups();});
$('messageForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!peer||!self)return;
 const text=$('messageText').value.trim();const file=selectedFile;
 if((!text&&!file)||text.length>2000)return;
 const btn=$('sendMessage');btn.disabled=true;$('attachToggle').disabled=true;
 const kind=peer.kind,conversationIdValue=kind==='group'?peer.id:conversationId(self.uid,peer.uid);
 let bridge=null;
 try{if(file)bridge=openDriveBridge();}catch(err){status('Lampiran gagal: '+err.message);btn.disabled=false;$('attachToggle').disabled=false;return;}
 try{
  let attachment=null;
  if(file){status('Proses kirim...');
   const base64=await fileAsBase64(file);
   attachment=await driveRequest({action:'upload',kind,conversationId:conversationIdValue,fileName:file.name,mimeType:file.type||({'pdf':'application/pdf','docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','ppt':'application/vnd.ms-powerpoint','jpg':'image/jpeg','jpeg':'image/jpeg','png':'image/png','gif':'image/gif'}[file.name.split('.').pop().toLowerCase()]),base64},bridge);
  }
  const message={senderId:self.uid,text:text||'📎 Lampiran',createdAt:serverTimestamp()};
  const externalLinks=pasuraLinks(text).filter(u=>!pasuraTrusted(u));
  if(externalLinks.length>1)throw Error('Untuk moderasi, kirim maksimal satu tautan eksternal per pesan.');
  if(externalLinks.length)message.linkStatus='pending';
  if(attachment)message.attachment={id:attachment.id,name:attachment.name,mimeType:attachment.mimeType,size:attachment.size,conversationId:conversationIdValue,kind};
  const sent=await addDoc(collection(db,kind==='group'?'groups':'conversations',conversationIdValue,'messages'),message);
  if(externalLinks.length){try{await setDoc(doc(db,'linkReviews',sent.id),{kind:kind==='group'?'groups':'conversations',chatId:conversationIdValue,messageId:sent.id,senderId:self.uid,urls:externalLinks,reviewStatus:'pending',createdAt:serverTimestamp()});}catch(reviewErr){console.error('Moderasi link gagal dicatat',reviewErr);status('Pesan terkirim, tetapi permohonan link gagal tercatat. Hubungi admin.');}}
  $('messageText').value='';clearAttachment();status('');
 }catch(err){status('Pesan/lampiran gagal dikirim: '+err.message);}
 finally{btn.disabled=false;$('attachToggle').disabled=false;}
});

onAuthStateChanged(auth,async u=>{if(!u){back();return;}try{await reload(u);if(!u.emailVerified){back();return;}const p=await getDoc(doc(db,'users',u.uid));if(!p.exists()||p.data().status!=='active'){back();return;}self={uid:u.uid,...p.data()};window.dispatchEvent(new CustomEvent('nusa:auth',{detail:{uid:u.uid,name:self.name}}));loadHidden();loadHistory();pasuraWatchReviews();$('welcome').textContent='Selamat datang, '+self.name;const snap=await getDocs(query(collection(db,'users'),where('status','==','active')));contacts=snap.docs.filter(d=>d.id!==u.uid).map(d=>({uid:d.id,name:d.data().name||'Pengguna',orgId:d.data().orgId||''}));
// Ambil nama instansi dari organizations; jangan tampilkan ID dokumen jika nama tersedia.
try {
 const orgSnap=await getDocs(collection(db,'organizations'));
 const orgNames=new Map(orgSnap.docs.map(d=>[d.id,(d.data().name||d.data().nama_instansi||'').trim()]));
 contacts=contacts.map(c=>({...c,orgName:orgNames.get(c.orgId)||''}));
} catch(orgError) {
 console.warn('Nama instansi belum dapat dimuat; ID ditampilkan sebagai cadangan.',orgError);
}
drawContacts();watchPrivate();watchGroups();drawNotice();}catch(e){status('Gagal memuat akun atau kontak: '+e.message);$('contacts').textContent='Tidak dapat memuat kontak.';}});
