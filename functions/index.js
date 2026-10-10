const {onCall,HttpsError}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
admin.initializeApp();
const db=admin.firestore();
const region='asia-southeast2';
const clean=(v,n=120)=>String(v||'').trim().slice(0,n);
const requireAuth=(req)=>{if(!req.auth)throw new HttpsError('unauthenticated','Silakan login.');return req.auth.uid;};
async function actor(req){const uid=requireAuth(req);const s=await db.doc(`users/${uid}`).get();if(!s.exists||s.data().status!=='active')throw new HttpsError('permission-denied','Akun belum aktif.');return {uid,...s.data()};}
function canManage(a,u){return a.role==='super_admin'||(a.role==='org_admin'&&a.orgId===u.orgId);}
exports.registerProfile=onCall({region,enforceAppCheck:false},async req=>{
 const uid=requireAuth(req),name=clean(req.data?.name,80),orgId=clean(req.data?.orgId,100);
 if(name.length<2||!orgId)throw new HttpsError('invalid-argument','Nama dan instansi wajib diisi.');
 const authUser=await admin.auth().getUser(uid);
 if(!authUser.email||!authUser.emailVerified)throw new HttpsError('failed-precondition','Verifikasi email dahulu.');
 const org=await db.doc(`organizations/${orgId}`).get();if(!org.exists||org.data().active!==true)throw new HttpsError('invalid-argument','Instansi tidak tersedia.');
 const ref=db.doc(`users/${uid}`);
 await db.runTransaction(async tx=>{const existing=await tx.get(ref);if(existing.exists)throw new HttpsError('already-exists','Profil sudah terdaftar.');tx.create(ref,{name,email:authUser.email,orgId,role:'member',status:'pending',createdAt:admin.firestore.FieldValue.serverTimestamp()});});
 return {ok:true};
});
exports.reviewUser=onCall({region},async req=>{
 const a=await actor(req),targetUid=clean(req.data?.uid,128),decision=req.data?.decision;
 if(!['active','rejected'].includes(decision)||!targetUid)throw new HttpsError('invalid-argument','Keputusan tidak valid.');
 const ref=db.doc(`users/${targetUid}`);await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(!snap.exists)throw new HttpsError('not-found','Pengguna tidak ditemukan.');const u=snap.data();if(!canManage(a,u)||u.status!=='pending'||u.role!=='member')throw new HttpsError('permission-denied','Tidak diizinkan.');tx.update(ref,{status:decision,reviewedBy:a.uid,reviewedAt:admin.firestore.FieldValue.serverTimestamp()});});return {ok:true};
});
exports.listPending=onCall({region},async req=>{
 const a=await actor(req);if(!['super_admin','org_admin'].includes(a.role))throw new HttpsError('permission-denied','Khusus admin.');
 let q=db.collection('users').where('status','==','pending');if(a.role==='org_admin')q=q.where('orgId','==',a.orgId);const s=await q.limit(100).get();return {users:s.docs.map(d=>({uid:d.id,name:d.data().name,email:d.data().email,orgId:d.data().orgId}))};
});
exports.createOrganization=onCall({region},async req=>{
 const a=await actor(req);if(a.role!=='super_admin')throw new HttpsError('permission-denied','Khusus Super Admin.');
 const id=clean(req.data?.id,50).toLowerCase(),name=clean(req.data?.name,120);
 if(!/^[a-z0-9-]{3,50}$/.test(id)||name.length<3)throw new HttpsError('invalid-argument','ID atau nama instansi tidak valid.');
 await db.doc(`organizations/${id}`).create({name,active:true,createdAt:admin.firestore.FieldValue.serverTimestamp()});return {ok:true};
});
exports.assignOrgAdmin=onCall({region},async req=>{
 const a=await actor(req);if(a.role!=='super_admin')throw new HttpsError('permission-denied','Khusus Super Admin.');
 const uid=clean(req.data?.uid,128);const ref=db.doc(`users/${uid}`);await db.runTransaction(async tx=>{const s=await tx.get(ref);if(!s.exists||s.data().status!=='active')throw new HttpsError('failed-precondition','Pengguna harus aktif.');tx.update(ref,{role:'org_admin'});});return {ok:true};
});
