// Run locally with GOOGLE_APPLICATION_CREDENTIALS pointing to a private service account JSON.
const admin=require('../functions/node_modules/firebase-admin');admin.initializeApp();
const uid=process.argv[2],orgId=process.argv[3];if(!uid||!orgId)throw Error('Usage: node scripts/bootstrap-superadmin.cjs UID ORG_ID');
(async()=>{const auth=await admin.auth().getUser(uid);if(!auth.emailVerified)throw Error('Verify email first');
const db=admin.firestore();await db.doc(`organizations/${orgId}`).set({name:'Instansi Utama',active:true,createdAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
await db.doc(`users/${uid}`).set({name:auth.displayName||'Super Admin',email:auth.email,orgId,role:'super_admin',status:'active',createdAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});console.log('Super Admin ready:',uid);})();
