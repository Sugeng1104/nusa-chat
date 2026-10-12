import {initializeApp,getApps,getApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getAuth,onAuthStateChanged,signOut} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {getFirestore,collection,doc,getDoc,getDocs,updateDoc,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {firebaseConfig} from './firebase-config.js';
const app=getApps().length?getApp():initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
const $=id=>document.getElementById(id);let me=null,users=[],orgs=[],renameTarget=null;
const msg=s=>$('message').textContent=s;
const statusLabel={active:'Aktif',pending:'Menunggu',rejected:'Ditolak',deleted:'Nonaktif'};
const orgName=id=>orgs.find(o=>o.id===id)?.name||id||'—';
async function load(){
 const [us,os]=await Promise.all([getDocs(collection(db,'users')),getDocs(collection(db,'organizations'))]);
 users=us.docs.map(d=>({uid:d.id,...d.data()}));orgs=os.docs.map(d=>({id:d.id,...d.data()}));
 $('total').textContent=users.length;$('active').textContent=users.filter(u=>u.status==='active').length;
 $('pending').textContent=users.filter(u=>u.status==='pending').length;draw();msg('Data diperbarui.');
}
function button(text,cls,fn){const b=document.createElement('button');b.textContent=text;b.className=cls||'';b.type='button';b.onclick=fn;return b;}
function draw(){
 const term=$('search').value.trim().toLowerCase(),status=$('filter').value;
 const rows=users.filter(u=>(!status||u.status===status)&&[u.name,u.email,u.orgId,orgName(u.orgId)].join(' ').toLowerCase().includes(term));
 $('users').replaceChildren();
 if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=6;td.textContent='Tidak ada akun.';tr.append(td);$('users').append(tr);return;}
 for(const u of rows){
  const tr=document.createElement('tr');
  for(const val of [u.name||'—',u.email||'—',orgName(u.orgId),u.role||'—',statusLabel[u.status]||u.status||'—']){
   const td=document.createElement('td');td.textContent=val;tr.append(td);
  }
  const td=document.createElement('td');
  td.append(button('Ubah nama','secondary',()=>{renameTarget=u;$('renameWho').textContent=u.email||u.uid;$('newName').value=u.name||'';$('renameDialog').showModal();}));
  if(u.uid!==me.uid&&u.role!=='super_admin'){
   if(u.status==='pending')td.append(button('Setujui','',()=>setStatus(u,'active')),button('Tolak','danger',()=>setStatus(u,'rejected')));
   if(['active','pending','rejected'].includes(u.status))td.append(button('Nonaktifkan','danger',()=>setStatus(u,'deleted')));
  }
  tr.append(td);$('users').append(tr);
 }
}
async function setStatus(u,status){
 if(!confirm(`Ubah status ${u.name||u.email} menjadi ${statusLabel[status]}?`))return;
 try{
  const ref=doc(db,'users',u.uid),fresh=await getDoc(ref);
  if(!fresh.exists()||fresh.data().status!==u.status)throw Error('Status telah berubah. Segarkan halaman.');
  if(status==='deleted'){
   if(fresh.data().role==='super_admin'||u.uid===me.uid)throw Error('Super Admin tidak dapat dinonaktifkan dari panel ini.');
   await updateDoc(ref,{status:'deleted',deletedBy:me.uid,deletedAt:serverTimestamp()});
  }else{
   if(u.status!=='pending'||fresh.data().role!=='member')throw Error('Hanya anggota berstatus pending yang bisa disetujui atau ditolak.');
   await updateDoc(ref,{status,reviewedBy:me.uid,reviewedAt:serverTimestamp()});
  }
  await load();
 }catch(e){msg('Gagal mengubah status: '+(e.code||e.message));}
}
$('renameForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!renameTarget)return;
 const name=$('newName').value.trim();if(name.length<2||name.length>100){msg('Nama harus 2–100 karakter.');return;}
 const b=e.submitter;b.disabled=true;
 try{
  await updateDoc(doc(db,'users',renameTarget.uid),{name});
  $('renameDialog').close();renameTarget=null;await load();msg('Nama berhasil diperbarui.');
 }catch(err){msg('Gagal mengubah nama: '+(err.code||err.message));}finally{b.disabled=false;}
});
$('cancelRename').onclick=()=>$('renameDialog').close();
$('search').oninput=draw;$('filter').onchange=draw;
$('refresh').onclick=()=>load().catch(e=>msg('Gagal memuat: '+(e.code||e.message)));
$('logout').onclick=async()=>{await signOut(auth);location.href='login.html';};
onAuthStateChanged(auth,async user=>{
 if(!user){location.replace('login.html');return;}
 try{
  await user.getIdToken(true);
  const s=await getDoc(doc(db,'users',user.uid));
  if(!user.emailVerified||!s.exists()||s.data().status!=='active'||s.data().role!=='super_admin'){
   document.querySelector('main').replaceChildren();
   const p=document.createElement('p');p.textContent='Akses ditolak. Halaman ini hanya untuk Super Admin aktif dengan email terverifikasi.';document.querySelector('main').append(p);return;
  }
  me={uid:user.uid,...s.data()};$('welcome').textContent='Halo, '+me.name+' · Super Admin';
  await load();
 }catch(e){msg('Gagal memeriksa akses: '+(e.code||e.message));}
});
