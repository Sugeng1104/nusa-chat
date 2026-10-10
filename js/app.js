import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getAuth,createUserWithEmailAndPassword,signInWithEmailAndPassword,sendEmailVerification,signOut,onAuthStateChanged,reload} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {getFirestore,doc,getDoc,collection,getDocs} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {getFunctions,httpsCallable} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js';
import {firebaseConfig} from './firebase-config.js';
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app),fn=getFunctions(app,'asia-southeast2');
const $=id=>document.getElementById(id),message=(t)=>{const el=$('message');if(el)el.textContent=t;};
const call=(name,data)=>httpsCallable(fn,name)(data);
const escape=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const base=location.pathname.split('/').slice(0,-1).join('/')+'/';const go=file=>location.href=base+file;
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
 e.preventDefault();message('Memeriksa akun...');
 try{await signInWithEmailAndPassword(auth,$('email').value.trim(),$('password').value);await route();}
 catch(err){message(err.message);}
});
async function route(){
 const u=auth.currentUser;if(!u)return;
 await reload(u); // Ambil status verifikasi email terbaru dari Firebase.
 if(!u.emailVerified){message('Verifikasi email Anda dahulu melalui tautan yang dikirim Firebase.');return;}
 let snap=await getDoc(doc(db,'users',u.uid));
 if(!snap.exists()){
  const draft=readDraft(u.uid);
  if(!draft?.name||!draft?.orgId){message('Profil belum dibuat dan data registrasi tidak ditemukan pada browser ini. Hubungi administrator untuk pemulihan akun.');return;}
  try{await call('registerProfile',{name:draft.name,orgId:draft.orgId});}
  catch(err){if(err.code!=='functions/already-exists')throw err;}
  snap=await getDoc(doc(db,'users',u.uid));
  if(!snap.exists())throw Error('Profil belum tersedia. Silakan coba periksa status lagi.');
 }
 localStorage.removeItem(draftKey(u.uid));
 const profile=snap.data();
 if(profile.status==='pending'){message('Akun Anda menunggu persetujuan admin.');return;}
 if(profile.status!=='active'){message('Akun tidak aktif: '+profile.status);return;}
 go(['super_admin','org_admin'].includes(profile.role)?'admin.html':'chat.html');
}
$('loginCheck')?.addEventListener('click',()=>route().catch(e=>message(e.message)));
$('logout')?.addEventListener('click',async()=>{await signOut(auth);go('login.html');});
async function loadAdmin(){const u=auth.currentUser;if(!u)return;const s=await getDoc(doc(db,'users',u.uid));if(!s.exists||s.data().status!=='active'||!['super_admin','org_admin'].includes(s.data().role)){go('login.html');return;}$('welcome').textContent='Halo, '+s.data().name+' ('+s.data().role+')';await refreshPending();if(s.data().role==='super_admin')$('superPanel').hidden=false;}
async function refreshPending(){const res=await call('listPending',{}),users=res.data.users;$('pending').innerHTML=users.length?users.map(u=>`<div class="item"><div><b>${escape(u.name)}</b><small>${escape(u.email)} · ${escape(u.orgId)}</small></div><div><button data-id="${escape(u.uid)}" data-decision="active">Setujui</button> <button class="secondary" data-id="${escape(u.uid)}" data-decision="rejected">Tolak</button></div></div>`).join(''):'Tidak ada pendaftaran menunggu.';}
$('pending')?.addEventListener('click',async e=>{const b=e.target.closest('button[data-id]');if(!b)return;b.disabled=true;try{await call('reviewUser',{uid:b.dataset.id,decision:b.dataset.decision});await refreshPending();message('Keputusan tersimpan.');}catch(err){message(err.message);b.disabled=false;}});
$('orgForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await call('createOrganization',{id:$('orgId').value,name:$('orgName').value});message('Instansi berhasil dibuat.');}catch(err){message(err.message);}});
$('adminForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await call('assignOrgAdmin',{uid:$('adminUid').value});message('Admin instansi berhasil ditetapkan.');}catch(err){message(err.message);}});
if($('org'))loadOrgs();if($('adminPage'))onAuthStateChanged(auth,u=>{if(!u)go('login.html');else loadAdmin().catch(e=>message(e.message));});
if($('chatPage'))onAuthStateChanged(auth,async u=>{if(!u){go('login.html');return;}const s=await getDoc(doc(db,'users',u.uid));if(!s.exists||s.data().status!=='active'){go('login.html');return;}$('welcome').textContent='Selamat datang, '+s.data().name;});
