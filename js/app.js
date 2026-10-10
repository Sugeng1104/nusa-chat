import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getAuth,createUserWithEmailAndPassword,signInWithEmailAndPassword,sendEmailVerification,signOut,onAuthStateChanged,reload} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {getFirestore,doc,getDoc,setDoc,updateDoc,collection,getDocs,query,where,writeBatch,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
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
function saveDraft(uid,name,orgId,registrationCode){localStorage.setItem(draftKey(uid),JSON.stringify({name,orgId,registrationCode}));}
function readDraft(uid){try{return JSON.parse(localStorage.getItem(draftKey(uid))||'null');}catch{return null;}}
$('registerForm')?.addEventListener('submit',async e=>{
 e.preventDefault();message('Mendaftarkan akun...');
 const name=$('name').value.trim(),email=$('email').value.trim(),password=$('password').value,orgId=$('org').value,registrationCode=$('registrationCode').value.trim().toUpperCase().replace(/\s/g,'');
 try{
  if(name.length<2)throw Error('Nama minimal 2 karakter.');
  if(!orgId)throw Error('Pilih instansi.');
  if(!/^[A-Z2-9]{12}$/.test(registrationCode))throw Error('Masukkan kode pendaftaran instansi yang valid (12 karakter).');
  const c=await createUserWithEmailAndPassword(auth,email,password);
  saveDraft(c.user.uid,name,orgId,registrationCode);
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
  if(!draft?.name||!draft?.orgId||!draft?.registrationCode){message('Profil belum dibuat dan data registrasi tidak ditemukan pada browser ini. Hubungi administrator untuk pemulihan akun.');return;}
  const batch=writeBatch(db);
  batch.set(doc(db,'registrationProofs',u.uid),{orgId:draft.orgId,code:draft.registrationCode,createdAt:serverTimestamp()});
  batch.set(doc(db,'users',u.uid),{name:draft.name,email:u.email,orgId:draft.orgId,role:'member',status:'pending',createdAt:serverTimestamp()});
  try{await batch.commit();}catch(err){throw Error('Kode pendaftaran instansi salah atau belum diaktifkan. Periksa kode dan hubungi administrator. ('+err.code+')');}
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

let currentAdmin=null,orgCache=[],userCache=[];
const fmt=(v)=>String(v??'');
function randomCode(){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',a=new Uint32Array(12);crypto.getRandomValues(a);return [...a].map(n=>alphabet[n%alphabet.length]).join('');}
function showAdminMsg(t){message(t);}
async function loadAdmin(){
 const u=auth.currentUser;if(!u)return;
 const s=await getDoc(doc(db,'users',u.uid));
 if(!s.exists()||s.data().status!=='active'||!['super_admin','org_admin'].includes(s.data().role)){go('login.html');return;}
 currentAdmin={uid:u.uid,...s.data()};
 $('welcome').textContent='Halo, '+currentAdmin.name+' · '+(currentAdmin.role==='super_admin'?'Super Admin':'Admin Instansi');
 $('roleLabel').textContent=currentAdmin.role==='super_admin'?'Super Admin':'Admin Instansi';
 $('superPanel').hidden=currentAdmin.role!=='super_admin';
 await refreshDashboard();
}
async function refreshDashboard(){
 if(!currentAdmin)return;
 const uq=currentAdmin.role==='super_admin'?collection(db,'users'):query(collection(db,'users'),where('orgId','==',currentAdmin.orgId));
 const [usersResult,orgsResult]=await Promise.allSettled([getDocs(uq),getDocs(collection(db,'organizations'))]);
 const problems=[];
 if(usersResult.status==='fulfilled'){
  userCache=usersResult.value.docs.map(d=>({uid:d.id,...d.data()}));
  $('statUsers').textContent=userCache.length;
  $('statPending').textContent=userCache.filter(u=>u.status==='pending').length;
  $('statActive').textContent=userCache.filter(u=>u.status==='active').length;
 }else{
  userCache=[];
  $('statUsers').textContent=$('statPending').textContent=$('statActive').textContent='—';
  problems.push('Data pengguna: '+(usersResult.reason?.code||usersResult.reason?.message||'gagal dibaca'));
 }
 if(orgsResult.status==='fulfilled'){
  orgCache=orgsResult.value.docs.map(d=>({id:d.id,...d.data()}));
  $('statOrgs').textContent=currentAdmin.role==='super_admin'?orgCache.length:orgCache.filter(o=>o.id===currentAdmin.orgId).length;
  drawOrgs();
 }else{
  orgCache=[];$('statOrgs').textContent='—';
  $('orgList').textContent='Gagal memuat instansi: '+(orgsResult.reason?.code||orgsResult.reason?.message||'kesalahan tidak diketahui')+'. Periksa Firestore Rules.';
  problems.push('Daftar instansi: '+(orgsResult.reason?.code||orgsResult.reason?.message||'gagal dibaca'));
 }
 if(usersResult.status==='fulfilled')drawPending();
 else $('pending').textContent='Gagal memuat permohonan: '+(usersResult.reason?.code||usersResult.reason?.message||'kesalahan tidak diketahui')+'.';
 if(problems.length)showAdminMsg(problems.join(' | '));else showAdminMsg('Data dashboard berhasil diperbarui.');
}
function drawPending(){
 const term=($('pendingSearch')?.value||'').trim().toLowerCase();
 const users=userCache.filter(u=>u.status==='pending'&&[u.name,u.email,u.orgId].join(' ').toLowerCase().includes(term));
 const el=$('pending');el.replaceChildren();
 if(!users.length){el.textContent='Tidak ada pendaftaran menunggu.';return;}
 for(const u of users){
  const row=document.createElement('div');row.className='nc-item';
  const desc=document.createElement('div');desc.className='nc-item-main';
  const title=document.createElement('strong');title.textContent=u.name||'Tanpa nama';
  const small=document.createElement('small');small.textContent=(u.email||'')+' · '+(orgCache.find(o=>o.id===u.orgId)?.name||u.orgId);
  desc.append(title,small);
  const actions=document.createElement('div');actions.className='nc-actions';
  for(const [status,label,cls] of [['active','Setujui',''],['rejected','Tolak','nc-danger']]){
   const btn=document.createElement('button');btn.type='button';btn.className=cls;btn.textContent=label;
   btn.addEventListener('click',async()=>{if(!confirm(label+' pendaftaran '+u.name+'?'))return;btn.disabled=true;try{await updateDoc(doc(db,'users',u.uid),{status,reviewedBy:auth.currentUser.uid,reviewedAt:serverTimestamp()});showAdminMsg('Keputusan berhasil disimpan.');await refreshDashboard();}catch(e){showAdminMsg('Gagal menyimpan keputusan: '+e.message);btn.disabled=false;}});
   actions.append(btn);
  }
  row.append(desc,actions);el.append(row);
 }
}
function drawOrgs(){
 const el=$('orgList');if(!el)return;el.replaceChildren();
 for(const o of orgCache.filter(o=>currentAdmin.role==='super_admin'||o.id===currentAdmin.orgId)){
  const row=document.createElement('div');row.className='nc-item';
  const d=document.createElement('div');d.className='nc-item-main';
  const title=document.createElement('strong');title.textContent=o.name||o.id;
  const small=document.createElement('small');small.textContent='ID internal: '+o.id;
  d.append(title,small);row.append(d);
  if(currentAdmin.role==='super_admin'){
   const b=document.createElement('button');b.type='button';b.className='nc-outline';b.textContent='Lihat / Buat Kode';
   b.addEventListener('click',async()=>{
    b.disabled=true;
    try{
     const ref=doc(db,'orgSecrets',o.id),s=await getDoc(ref);
     let code;
     if(s.exists()){code=s.data().code;}
     else{code=randomCode();await setDoc(ref,{code,createdAt:serverTimestamp()});}
     $('generatedCode').textContent=code;$('codeFor').textContent=o.name;
     $('codeResult').hidden=false;showAdminMsg('Kode pendaftaran tersedia. Bagikan hanya kepada guru yang berhak.');
    }catch(e){showAdminMsg('Tidak dapat memuat kode: '+e.message);}
    finally{b.disabled=false;}
   });row.append(b);
  }
  el.append(row);
 }
}
$('pendingSearch')?.addEventListener('input',drawPending);
$('refreshAdmin')?.addEventListener('click',()=>refreshDashboard().catch(e=>showAdminMsg(e.message)));
$('copyCode')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('generatedCode').textContent);showAdminMsg('Kode disalin.');}catch(e){showAdminMsg('Salin kode secara manual.');}});
$('orgForm')?.addEventListener('submit',async e=>{
 e.preventDefault();const btn=e.submitter;btn.disabled=true;
 try{
  if(currentAdmin?.role!=='super_admin')throw Error('Hanya Super Admin.');
  const name=$('orgName').value.trim();if(name.length<3)throw Error('Nama instansi minimal 3 karakter.');
  const ref=doc(collection(db,'organizations')),code=randomCode(),batch=writeBatch(db);
  batch.set(ref,{name,active:true,createdAt:serverTimestamp()});
  batch.set(doc(db,'orgSecrets',ref.id),{code,createdAt:serverTimestamp()});
  await batch.commit();
  $('codeFor').textContent=name;$('generatedCode').textContent=code;$('codeResult').hidden=false;
  $('orgName').value='';showAdminMsg('Instansi berhasil dibuat. Simpan kode pendaftarannya.');
  await refreshDashboard();
 }catch(err){showAdminMsg('Gagal membuat instansi: '+err.message);}finally{btn.disabled=false;}
});
$('adminForm')?.addEventListener('submit',async e=>{
 e.preventDefault();
 try{
  if(currentAdmin?.role!=='super_admin')throw Error('Hanya Super Admin.');
  const uid=$('adminUid').value.trim(),ref=doc(db,'users',uid),s=await getDoc(ref);
  if(!s.exists()||s.data().status!=='active'||s.data().role!=='member')throw Error('UID harus milik anggota aktif.');
  await updateDoc(ref,{role:'org_admin'});showAdminMsg('Admin Instansi berhasil ditetapkan.');await refreshDashboard();
 }catch(err){showAdminMsg('Gagal menetapkan admin: '+err.message);}
});

if($('org'))loadOrgs();if($('adminPage'))onAuthStateChanged(auth,u=>{if(!u)go('login.html');else loadAdmin().catch(e=>{message('Gagal memuat dashboard: '+(e.code||e.message));if($('orgList'))$('orgList').textContent='Tidak dapat memuat data. Periksa pesan kesalahan di atas.';if($('pending'))$('pending').textContent='Tidak dapat memuat data.';});});
if($('chatPage'))onAuthStateChanged(auth,async u=>{if(!u){go('login.html');return;}const s=await getDoc(doc(db,'users',u.uid));if(!s.exists()||s.data().status!=='active'){go('login.html');return;}$('welcome').textContent='Selamat datang, '+s.data().name;});
