import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getAuth,createUserWithEmailAndPassword,signInWithEmailAndPassword,sendEmailVerification,signOut,onAuthStateChanged,reload} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {getFirestore,doc,getDoc,setDoc,updateDoc,collection,getDocs,query,where,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {firebaseConfig} from './firebase-config.js';
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
const $=id=>document.getElementById(id),message=(t)=>{const el=$('message');if(el)el.textContent=t;};
const escape=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const base=location.pathname.split('/').slice(0,-1).join('/')+'/';const go=file=>location.href=base+file;
const verifyButton=$('sendVerification');
function showVerification(show){if(verifyButton)verifyButton.hidden=!show;}
async function resendVerification(){
 const u=auth.currentUser;
 if(!u){message('Masukkan email dan password, lalu klik Masuk terlebih dahulu.');return;}
 try{
  verifyButton.disabled=true;
  await reload(u);
  if(u.emailVerified){showVerification(false);message('Email sudah diverifikasi. Klik Periksa status akun.');return;}
  await sendEmailVerification(u);
  message('Email verifikasi berhasil dikirim. Periksa Kotak Masuk dan Spam, lalu klik tautannya.');
 }catch(err){
  if(err.code==='auth/too-many-requests')message('Terlalu banyak permintaan. Tunggu sebelum mengirim ulang.');
  else message('Gagal mengirim email verifikasi: '+err.message);
 }finally{verifyButton.disabled=false;}
}
verifyButton?.addEventListener('click',resendVerification);
async function loadOrgs(){const sel=$('org');if(!sel)return;try{const snap=await getDocs(collection(db,'organizations'));sel.innerHTML='<option value="">Pilih instansi</option>'+snap.docs.filter(d=>d.data().active).map(d=>`<option value="${escape(d.id)}">${escape(d.data().name)}</option>`).join('');}catch(e){message('Tidak dapat memuat instansi: '+e.message);}}
// Draf pendaftaran hanya menyimpan nama dan ID instansi, bukan password.
const draftKey=uid=>`nusa-registration-${uid}`;
function saveDraft(uid,name,orgId){localStorage.setItem(draftKey(uid),JSON.stringify({name,orgId}));}
function readDraft(uid){try{return JSON.parse(localStorage.getItem(draftKey(uid))||'null');}catch{return null;}}
$('registerForm')?.addEventListener('submit',async e=>{
 e.preventDefault();message('Mendaftarkan akun...');
 const name=$('name').value.trim(),email=$('email').value.trim(),password=$('password').value,orgId=$('org').value;
 try{
  if(name.length<2)throw Error('Nama minimal 2 karakter.');
  if(!orgId)throw Error('Pilih instansi.');
  const c=await createUserWithEmailAndPassword(auth,email,password);
  saveDraft(c.user.uid,name,orgId);
  try{await sendEmailVerification(c.user);message('Email verifikasi dikirim. Buka tautan pada email, lalu masuk dengan akun Anda.');}
  catch(err){message('Akun dibuat, tetapi email verifikasi gagal dikirim: '+err.message);}
  await signOut(auth);
 }catch(err){message(err.message);}
});
$('loginForm')?.addEventListener('submit',async e=>{
 e.preventDefault();showVerification(false);message('Memeriksa akun...');
 try{await signInWithEmailAndPassword(auth,$('email').value.trim(),$('password').value);await route();}
 catch(err){message(err.message);}
});
async function route(){
 const u=auth.currentUser;if(!u){message('Silakan masukkan email dan password lalu klik Masuk terlebih dahulu.');return;}
 await reload(u); // Ambil status verifikasi email terbaru dari Firebase.
 if(!u.emailVerified){showVerification(true);message('Email belum diverifikasi. Klik Kirim Email Verifikasi, lalu buka email Anda.');return;}
 showVerification(false);
 let snap=await getDoc(doc(db,'users',u.uid));
 if(!snap.exists()){
  const draft=readDraft(u.uid);
  if(!draft?.name||!draft?.orgId){message('Profil belum dibuat dan data registrasi tidak ditemukan pada browser ini. Hubungi administrator untuk pemulihan akun.');return;}
  await setDoc(doc(db,'users',u.uid),{name:draft.name,email:u.email,orgId:draft.orgId,role:'member',status:'pending',createdAt:serverTimestamp()});
  snap=await getDoc(doc(db,'users',u.uid));
  if(!snap.exists())throw Error('Profil belum tersedia. Silakan coba periksa status lagi.');
 }
 localStorage.removeItem(draftKey(u.uid));
 const profile=snap.data();
 if(profile.status==='pending'){message('Akun Anda menunggu persetujuan admin.');return;}
 if(profile.status!=='active'){message('Akun tidak aktif: '+profile.status);return;}
 go(['super_admin','org_admin'].includes(profile.role)?'admin.html':'chat.html');
}
$('loginCheck')?.addEventListener('click',async()=>{message('Memperbarui status akun dari Firebase...');try{await route();}catch(e){message('Gagal memeriksa status: '+e.message);}});
if($('loginForm'))onAuthStateChanged(auth,u=>{showVerification(Boolean(u&&!u.emailVerified));});
$('logout')?.addEventListener('click',async()=>{await signOut(auth);go('login.html');});
async function loadAdmin(){const u=auth.currentUser;if(!u)return;const s=await getDoc(doc(db,'users',u.uid));if(!s.exists||s.data().status!=='active'||!['super_admin','org_admin'].includes(s.data().role)){go('login.html');return;}currentAdmin={uid:u.uid,...s.data()};$('welcome').textContent='Halo, '+s.data().name+' ('+s.data().role+')';await refreshPending();if(s.data().role==='super_admin')$('superPanel').hidden=false;}
let currentAdmin=null;
async function refreshPending(){
 if(!currentAdmin)return;
 const pendingQuery=currentAdmin.role==='super_admin'
  ?query(collection(db,'users'),where('status','==','pending'))
  :query(collection(db,'users'),where('status','==','pending'),where('orgId','==',currentAdmin.orgId));
 const snap=await getDocs(pendingQuery);
 const users=snap.docs.map(d=>({uid:d.id,...d.data()}));
 $('pending').innerHTML=users.length?users.map(u=>`<div class="item"><div><b>${escape(u.name)}</b><small>${escape(u.email)} · ${escape(u.orgId)}</small></div><div><button data-id="${escape(u.uid)}" data-decision="active">Setujui</button> <button class="secondary" data-id="${escape(u.uid)}" data-decision="rejected">Tolak</button></div></div>`).join(''):'Tidak ada pendaftaran menunggu.';
}
$('pending')?.addEventListener('click',async e=>{
 const b=e.target.closest('button[data-id]');if(!b)return;b.disabled=true;
 try{await updateDoc(doc(db,'users',b.dataset.id),{status:b.dataset.decision,reviewedBy:auth.currentUser.uid,reviewedAt:serverTimestamp()});await refreshPending();message('Keputusan tersimpan.');}
 catch(err){message(err.message);b.disabled=false;}
});
$('orgForm')?.addEventListener('submit',async e=>{
 e.preventDefault();
 try{
  const id=$('orgId').value.trim().toLowerCase(),name=$('orgName').value.trim();
  if(!/^[a-z0-9-]{3,50}$/.test(id)||name.length<3)throw Error('ID atau nama instansi tidak valid.');
  await setDoc(doc(db,'organizations',id),{name,active:true,createdAt:serverTimestamp()});
  message('Instansi berhasil dibuat.');
 }catch(err){message(err.message);}
});
$('adminForm')?.addEventListener('submit',async e=>{
 e.preventDefault();
 try{
  const uid=$('adminUid').value.trim();
  const ref=doc(db,'users',uid),snap=await getDoc(ref);
  if(!snap.exists()||snap.data().status!=='active'||snap.data().role!=='member')throw Error('Pilih pengguna aktif dengan peran member.');
  await updateDoc(ref,{role:'org_admin'});
  message('Admin instansi berhasil ditetapkan.');
 }catch(err){message(err.message);}
});
if($('org'))loadOrgs();if($('adminPage'))onAuthStateChanged(auth,u=>{if(!u)go('login.html');else loadAdmin().catch(e=>message(e.message));});
if($('chatPage'))onAuthStateChanged(auth,async u=>{if(!u){go('login.html');return;}const s=await getDoc(doc(db,'users',u.uid));if(!s.exists||s.data().status!=='active'){go('login.html');return;}$('welcome').textContent='Selamat datang, '+s.data().name;});
