import {initializeApp,getApps} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getAuth,onAuthStateChanged,reload} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {getFirestore,doc,getDoc} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {firebaseConfig} from './firebase-config.js';
const app=getApps()[0]||initializeApp(firebaseConfig);
const auth=getAuth(app),db=getFirestore(app);
onAuthStateChanged(auth,async user=>{
 if(!user)return;
 try{
  await reload(user);
  if(!user.emailVerified)return;
  const snap=await getDoc(doc(db,'users',user.uid));
  if(snap.exists()&&snap.data().status==='active')location.replace('chat.html');
 }catch(e){console.warn('Pemeriksaan sesi otomatis:',e);}
});
