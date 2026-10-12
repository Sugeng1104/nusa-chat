import {initializeApp,getApps,getApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getAuth,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {getFirestore,collection,doc,getDoc,getDocs,addDoc,updateDoc,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {firebaseConfig} from './firebase-config.js';
const app=getApps().length?getApp():initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app),$=id=>document.getElementById(id);
let admin=null,cases=[],selected=null,evidence=[],logs=[];
const say=t=>$('message').textContent=t;
const date=v=>v?.toDate?.().toLocaleString('id-ID')||'—';
function cell(row,value){const td=document.createElement('td');td.textContent=value;row.append(td);return td;}
async function log(action,id){await addDoc(collection(db,'auditCases',id,'logs'),{actor:admin.uid,action,createdAt:serverTimestamp()});}
async function refresh(){const s=await getDocs(collection(db,'auditCases'));cases=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));draw();}
function draw(){const body=$('cases');body.replaceChildren();const q=$('caseSearch').value.trim().toLowerCase();
 for(const c of cases.filter(c=>(c.title+' '+c.id).toLowerCase().includes(q))){const tr=document.createElement('tr');
 cell(tr,c.id);cell(tr,c.title);cell(tr,c.status);cell(tr,date(c.createdAt));const td=cell(tr,'');const b=document.createElement('button');b.textContent='Periksa';b.onclick=()=>openCase(c.id);td.append(b);body.append(tr);}
 if(!body.children.length){const tr=document.createElement('tr');cell(tr,'Tidak ada kasus yang cocok.').colSpan=5;body.append(tr);}}
async function openCase(id){try{const c=cases.find(x=>x.id===id);if(!c)return;selected=c;
 const [es,ls]=await Promise.all([getDocs(collection(db,'auditCases',id,'evidence')),getDocs(collection(db,'auditCases',id,'logs'))]);
 evidence=es.docs.map(d=>({id:d.id,...d.data()}));logs=ls.docs.map(d=>({id:d.id,...d.data()}));
 $('caseDetails').hidden=false;$('caseHeading').textContent=c.title+' ('+c.id+')';$('caseMeta').textContent='Status: '+c.status+' · Dibuat: '+date(c.createdAt);$('caseReasonText').textContent=c.reason;
 $('closeCase').disabled=c.status!=='open';const er=$('evidenceRows');er.replaceChildren();for(const e of evidence){const tr=document.createElement('tr');cell(tr,e.submittedBy);cell(tr,e.sourceType+' / '+e.sourceId);cell(tr,e.text);cell(tr,date(e.submittedAt));er.append(tr);}
 if(!evidence.length){const tr=document.createElement('tr');cell(tr,'Belum ada bukti yang diserahkan.').colSpan=4;er.append(tr);}
 const lr=$('auditRows');lr.replaceChildren();for(const l of logs){const tr=document.createElement('tr');cell(tr,l.actor);cell(tr,l.action);cell(tr,date(l.createdAt));lr.append(tr);}
 await log('case_viewed',id);say('Kasus dibuka dan tindakan pemeriksaan dicatat.');
 }catch(e){say('Gagal membuka kasus: '+(e.code||e.message));}}
$('caseForm').onsubmit=async e=>{e.preventDefault();if(!admin)return;const b=e.submitter;b.disabled=true;
 try{const ref=await addDoc(collection(db,'auditCases'),{title:$('caseTitle').value.trim(),reason:$('caseReason').value.trim(),status:'open',createdBy:admin.uid,createdAt:serverTimestamp()});
 await log('case_opened',ref.id);$('caseForm').reset();await refresh();say('Kasus dibuat. ID: '+ref.id+' — berikan ID kepada peserta yang akan menyerahkan bukti.');}
 catch(err){say('Gagal membuat kasus: '+(err.code||err.message));}finally{b.disabled=false;}};
$('caseSearch').oninput=draw;$('reloadCases').onclick=()=>refresh().catch(e=>say(e.message));
$('closeCase').onclick=async()=>{if(!selected||selected.status!=='open'||!confirm('Tutup kasus ini? Bukti tetap tersimpan.'))return;
 try{await updateDoc(doc(db,'auditCases',selected.id),{status:'closed',closedBy:admin.uid,closedAt:serverTimestamp()});await log('case_closed',selected.id);await refresh();await openCase(selected.id);say('Kasus ditutup.');}catch(e){say('Gagal menutup kasus: '+e.message);}};
$('exportCase').onclick=async()=>{if(!selected){say('Pilih kasus terlebih dahulu.');return;}
 try{await log('evidence_exported',selected.id);const payload={exportedAt:new Date().toISOString(),exportedBy:admin.uid,case:selected,evidence:evidence.map(e=>({...e,submittedAt:date(e.submittedAt)})),logs:logs.map(l=>({...l,createdAt:date(l.createdAt)})),disclaimer:'Bukti diserahkan peserta dan belum diverifikasi terhadap pesan asli.'};
 const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='audit-'+selected.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);say('Ekspor selesai. Log ekspor dicatat.');}catch(e){say('Ekspor gagal: '+e.message);}};
onAuthStateChanged(auth,async u=>{if(!u)return;try{const s=await getDoc(doc(db,'users',u.uid));if(!u.emailVerified||!s.exists()||s.data().role!=='super_admin'||s.data().status!=='active'){$('auditPanel').hidden=true;return;}admin={uid:u.uid,...s.data()};await refresh();}catch(e){say('Audit gagal dimuat: '+(e.code||e.message));}});
