import {initializeApp,getApps} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getAuth,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {getFirestore,doc,collection,addDoc,setDoc,updateDoc,onSnapshot,query,where,serverTimestamp,getDoc} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {firebaseConfig} from './firebase-config.js';
const app=getApps()[0]||initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
const el=id=>document.getElementById(id);
const voice=el('ncVoiceCall'),video=el('ncVideoCall'),dialog=el('ncCallDialog'),callStatus=el('ncCallStatus');
let user=null,selected=null,current=null,pc=null,stream=null,callStop=null,candidateStop=null,incomingStop=null,remoteCandidates=[],startedAt=0,clock=null,ringTimeout=null,ending=false;
const ICE={iceServers:[{urls:'stun:stun.l.google.com:19302'}]};
// Ringtone WAV + aktivasi audio eksplisit untuk pembatasan autoplay browser HP.
const ringtone=new Audio('sounds/nusa-ring.wav');ringtone.loop=true;ringtone.preload='auto';ringtone.volume=1;
const ringback=new Audio('sounds/nusa-ringback.wav');ringback.loop=true;ringback.preload='auto';ringback.volume=.65;
let ringMode=null,ringAllowed=false;
const ringEnable=document.getElementById('ncEnableRing');
function markRingReady(){ringAllowed=true;ringEnable.hidden=true;}
async function unlockRinger(){
  try{const a=ringtone;const wasMuted=a.muted;a.muted=true;await a.play();a.pause();a.currentTime=0;a.muted=wasMuted;markRingReady();}catch(e){console.info('Browser meminta interaksi untuk audio:',e.name);}
}
ringEnable.addEventListener('click',async()=>{
  try{ringtone.muted=false;await ringtone.play();markRingReady();}
  catch(e){ringEnable.hidden=false;ringEnable.textContent='🔔 Ketuk lagi untuk bunyikan dering';console.warn('Dering ditolak browser:',e);}
});
window.addEventListener('pointerdown',e=>{if(e.target!==ringEnable&&!ringAllowed)void unlockRinger();},{passive:true});
window.addEventListener('keydown',()=>{if(!ringAllowed)void unlockRinger();});
async function startRinging(mode){
  stopRinging();ringMode=mode;
  const audio=mode==='incoming'?ringtone:ringback;
  audio.currentTime=0;
  try{await audio.play();if(mode==='incoming')ringEnable.hidden=true;}
  catch(e){console.warn('Dering tidak bisa autoplay:',e.name,e.message);if(mode==='incoming'){ringEnable.hidden=false;ringEnable.textContent='🔔 Ketuk untuk bunyikan dering';}}
}
function stopRinging(){ringMode=null;for(const a of [ringtone,ringback]){a.pause();a.currentTime=0;}ringEnable.hidden=true;}
// Tombol Back pada HP menutup tampilan chat, bukan panggilan aktif.
// Guard ini hanya berlaku selama panggilan; tidak mempertahankan panggilan jika browser ditutup.
let callHistoryGuard=false;
function guardBack(){if(callHistoryGuard)return;try{history.pushState({nusaCallActive:true},'',location.href);callHistoryGuard=true;}catch{}}
window.addEventListener('popstate',()=>{if(current){try{history.pushState({nusaCallActive:true},'',location.href);}catch{}}else callHistoryGuard=false;});

function message(s){callStatus.textContent=s;}
function buttons(){const enabled=!!(selected?.kind==='private'&&user&&!current);voice.hidden=!enabled;video.hidden=!enabled;}
window.addEventListener('nusa:peer',e=>{selected=e.detail;buttons();});
window.addEventListener('nusa:auth',e=>{user=e.detail;buttons();listenIncoming();});
window.addEventListener('nusa:logout',()=>{void finish(true);incomingStop?.();});
onAuthStateChanged(auth,u=>{if(!u){user=null;incomingStop?.();incomingStop=null;void finish(true);buttons();}else if(!user){user={uid:u.uid,name:u.displayName||'Pengguna'};listenIncoming();}});
function setMode(kind,mode){el('ncVideoStage').hidden=kind!=='video';el('ncCamera').hidden=kind!=='video'||mode!=='connected';el('ncMute').hidden=mode!=='connected';el('ncAccept').hidden=mode!=='incoming';el('ncReject').hidden=mode!=='incoming';el('ncHangup').hidden=mode==='incoming';}
function showCall(name,kind,mode){el('ncCallTitle').textContent=(kind==='video'?'📹 Video Call':'☎ Telepon')+' · '+name;setMode(kind,mode);if(!dialog.open)dialog.showModal();guardBack();}
function clearTimer(){if(clock){clearInterval(clock);clock=null;}if(ringTimeout){clearTimeout(ringTimeout);ringTimeout=null;}}
function runTimer(){startedAt=Date.now();clock=setInterval(()=>{if(!current)return;const s=Math.floor((Date.now()-startedAt)/1000);message('Terhubung · '+String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0'));},1000);}
async function prepareMedia(kind){if(!navigator.mediaDevices?.getUserMedia)throw Error('Browser tidak mendukung akses mikrofon/kamera melalui HTTPS.');stream=await navigator.mediaDevices.getUserMedia({audio:true,video:kind==='video'});el('ncLocalVideo').srcObject=stream;}
async function setupPeer(id,kind,side){pc=new RTCPeerConnection(ICE);stream.getTracks().forEach(t=>pc.addTrack(t,stream));pc.ontrack=e=>{const remote=e.streams[0];if(kind==='video'){el('ncRemoteVideo').srcObject=remote;el('ncRemoteVideo').play().catch(()=>{});}else{el('ncRemoteAudio').srcObject=remote;el('ncRemoteAudio').play().catch(()=>{});}};
pc.onicecandidate=async e=>{if(!e.candidate||!current||current.id!==id)return;try{await addDoc(collection(db,'calls',id,side+'Candidates'),{candidate:e.candidate.toJSON(),uid:user.uid,createdAt:serverTimestamp()});}catch(err){console.warn('ICE gagal dikirim',err);}};
pc.onconnectionstatechange=()=>{if(!pc)return;if(pc.connectionState==='connected'){stopRinging();clearTimer();setMode(kind,'connected');runTimer();}else if(pc.connectionState==='failed'){message('Koneksi gagal. Coba jaringan lain atau layanan TURN.');void finish(false);}};
const other=side==='caller'?'callee':'caller';candidateStop=onSnapshot(collection(db,'calls',id,other+'Candidates'),snap=>{for(const ch of snap.docChanges()){if(ch.type!=='added')continue;const c=ch.doc.data().candidate;if(!c)continue;if(pc?.remoteDescription)pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.warn);else remoteCandidates.push(c);}},err=>console.warn('ICE listener',err));}
async function flushCandidates(){for(const c of remoteCandidates.splice(0)){await pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.warn);}}
async function start(kind){if(current||!user||selected?.kind!=='private')return;const to={...selected};try{current={kind,side:'caller',peerName:to.name,peerUid:to.uid};buttons();showCall(to.name,kind,'outgoing');message('Meminta izin perangkat...');await prepareMedia(kind);if(!current)return;
const ref=await addDoc(collection(db,'calls'),{callerId:user.uid,calleeId:to.uid,kind,status:'ringing',createdAt:serverTimestamp(),updatedAt:serverTimestamp()});current.id=ref.id;await setupPeer(ref.id,kind,'caller');const offer=await pc.createOffer();await pc.setLocalDescription(offer);await updateDoc(ref,{offer:{type:offer.type,sdp:offer.sdp},updatedAt:serverTimestamp()});message('Memanggil '+to.name+'...');void startRinging('outgoing');
callStop=onSnapshot(ref,async s=>{if(!current||current.id!==ref.id)return;const d=s.data();if(!d||d.status==='ended'||d.status==='rejected'||d.status==='missed'){message('Panggilan berakhir.');await finish(true);return;}if(d.answer&&!pc.remoteDescription){await pc.setRemoteDescription(new RTCSessionDescription(d.answer));await flushCandidates();}},e=>{message('Pemantauan panggilan gagal: '+e.message);void finish(true);});
ringTimeout=setTimeout(()=>{if(current?.id===ref.id&&pc?.connectionState!=='connected'){void updateDoc(ref,{status:'missed',updatedAt:serverTimestamp()}).catch(()=>{});void finish(true);}},45000);
}catch(err){message('Tidak dapat memulai panggilan: '+err.message);console.error(err);await finish(true);}}
async function listenIncoming(){incomingStop?.();if(!user)return;incomingStop=onSnapshot(query(collection(db,'calls'),where('calleeId','==',user.uid)),async snap=>{if(current)return;const pending=snap.docs.filter(d=>d.data().status==='ringing'&&d.data().offer).sort((a,b)=>(b.data().createdAt?.seconds||0)-(a.data().createdAt?.seconds||0))[0];if(!pending)return;const d=pending.data();if(d.callerId===user.uid)return;const age=Date.now()-(d.createdAt?.toMillis?.()||Date.now());if(age>60000)return;current={id:pending.id,kind:d.kind,side:'callee',peerUid:d.callerId,peerName:'Pengguna NUSA CHAT'};buttons();try{const p=await getDoc(doc(db,'users',d.callerId));if(p.exists())current.peerName=p.data().name||current.peerName;}catch{}showCall(current.peerName,d.kind,'incoming');message('Panggilan masuk...');void startRinging('incoming');callStop=onSnapshot(pending.ref,s=>{if(!s.exists()||['ended','rejected','missed'].includes(s.data().status))void finish(true);});},e=>console.warn('Panggilan masuk tidak dapat dipantau',e));}
async function accept(){if(!current||current.side!=='callee')return;stopRinging();const c={...current};try{message('Mengaktifkan mikrofon/kamera...');await prepareMedia(c.kind);if(current?.id!==c.id)return;await setupPeer(c.id,c.kind,'callee');const ref=doc(db,'calls',c.id),s=await getDoc(ref);if(!s.exists()||s.data().status!=='ringing'||!s.data().offer)throw Error('Panggilan tidak lagi tersedia.');await pc.setRemoteDescription(new RTCSessionDescription(s.data().offer));await flushCandidates();const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await updateDoc(ref,{answer:{type:answer.type,sdp:answer.sdp},status:'accepted',updatedAt:serverTimestamp()});setMode(c.kind,'connected');message('Menghubungkan...');}catch(err){message('Gagal menerima panggilan: '+err.message);await finish(false);}}
async function finish(localOnly=false,reject=false){if(ending)return;ending=true;const c=current;current=null;stopRinging();clearTimer();callStop?.();callStop=null;candidateStop?.();candidateStop=null;remoteCandidates=[];try{pc?.close();}catch{}pc=null;try{stream?.getTracks().forEach(t=>t.stop());}catch{}stream=null;el('ncLocalVideo').srcObject=null;el('ncRemoteVideo').srcObject=null;el('ncRemoteAudio').srcObject=null;if(dialog.open)dialog.close();buttons();if(c?.id&&!localOnly){try{await updateDoc(doc(db,'calls',c.id),{status:reject?'rejected':'ended',updatedAt:serverTimestamp()});}catch(e){console.warn('Tidak bisa menutup status panggilan',e);}}ending=false;}
voice.addEventListener('click',()=>start('audio'));video.addEventListener('click',()=>start('video'));
el('ncAccept').addEventListener('click',accept);el('ncReject').addEventListener('click',()=>finish(false,true));el('ncHangup').addEventListener('click',()=>finish(false));
el('ncMute').addEventListener('click',()=>{const track=stream?.getAudioTracks()[0];if(track){track.enabled=!track.enabled;el('ncMute').textContent=track.enabled?'🎤 Mikrofon':'🔇 Bisukan';}});
el('ncCamera').addEventListener('click',()=>{const track=stream?.getVideoTracks()[0];if(track){track.enabled=!track.enabled;el('ncCamera').textContent=track.enabled?'📹 Kamera':'🚫 Kamera';}});
dialog.addEventListener('cancel',e=>{e.preventDefault();void finish(false,current?.side==='callee');});
