package com.pmai.companionnative
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import app.tauri.plugin.JSObject
class CompanionPushService:FirebaseMessagingService(){
 override fun onNewToken(token:String){getSharedPreferences("companion-push",MODE_PRIVATE).edit().putString("token",token).apply();CompanionNativePlugin.instance?.publish("token-received",JSObject().put("token",token).put("platform","fcm"))}
 override fun onMessageReceived(message:RemoteMessage){val data=JSObject();message.data.forEach{(key,value)->data.put(key,value)};CompanionNativePlugin.instance?.publish("notification-received",data)}
}
