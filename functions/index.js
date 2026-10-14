const {onDocumentCreated,onDocumentUpdated}=require('firebase-functions/v2/firestore');
const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {getMessaging}=require('firebase-admin/messaging');
initializeApp();
const db=getFirestore();
async function pushTo(recipients,data){
  const unique=[...new Set(recipients)].filter(Boolean);
  for(const uid of unique){
    const user=await db.doc(`users/${uid}`).get();
    if(!user.exists||user.data().status!=='active')continue;
    const docs=await db.collection(`users/${uid}/fcmTokens`).get();
    const entries=docs.docs.filter(d=>typeof d.data().token==='string');
    if(!entries.length)continue;
    const tokens=entries.map(d=>d.data().token);
    const response=await getMessaging().sendEachForMulticast({tokens,data});
    const bad=[];
    response.responses.forEach((r,i)=>{
      if(r.success)return;
      const code=r.error?.code||'';
      if(['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(code))bad.push(entries[i].ref.delete());
      else console.warn('FCM delivery failed',uid,code);
    });
    if(bad.length)await Promise.allSettled(bad);
  }
}
async function onMessage(event,kind){
  const d=event.data?.data();if(!d?.senderId)return;
  const chatId=event.params.chatId;
  const parent=await db.doc(`${kind}/${chatId}`).get();if(!parent.exists)return;
  const users=kind==='groups'?parent.data().members:parent.data().participants;
  if(!Array.isArray(users)||!users.includes(d.senderId))return;
  await pushTo(users.filter(uid=>uid!==d.senderId),{type:'message',chatId:String(chatId),kind});
}
exports.privateMessagePush=onDocumentCreated({document:'conversations/{chatId}/messages/{messageId}',region:'asia-southeast2'},e=>onMessage(e,'conversations'));
exports.groupMessagePush=onDocumentCreated({document:'groups/{chatId}/messages/{messageId}',region:'asia-southeast2'},e=>onMessage(e,'groups'));
// Call creation precedes SDP offer. Notify only when the offer is written.
exports.incomingCallPush=onDocumentUpdated({document:'calls/{callId}',region:'asia-southeast2'},async e=>{
 const before=e.data.before.data(),after=e.data.after.data();
 if(!before||!after||before.offer||!after.offer||after.status!=='ringing')return;
 if(!after.callerId||!after.calleeId||after.callerId===after.calleeId)return;
 await pushTo([after.calleeId],{type:'call',callId:String(e.params.callId),kind:after.kind==='video'?'video':'audio'});
});
