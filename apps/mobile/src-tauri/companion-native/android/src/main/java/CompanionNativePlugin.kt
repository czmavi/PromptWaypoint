package com.pmai.companionnative
import android.app.Activity
import android.Manifest
import android.content.Intent
import android.os.Build
import android.webkit.WebView
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONArray

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
@InvokeArg class AuthArgs { lateinit var value:String }
@InvokeArg class PushArgs { var requestPermission:Boolean=false }
@TauriPlugin(permissions=[Permission(strings=[Manifest.permission.POST_NOTIFICATIONS],alias="notifications")])
class CompanionNativePlugin(private val activity:Activity):Plugin(activity){
 companion object { var instance:CompanionNativePlugin?=null }
 fun publish(event:String,data:JSObject){activity.runOnUiThread{trigger(event,data)}}
 override fun onDestroy(){if(instance===this)instance=null;super.onDestroy()}
 override fun load(webView:WebView){super.load(webView);instance=this;captureIntent(activity.intent)}
 override fun onNewIntent(intent:Intent){super.onNewIntent(intent);captureIntent(intent)}
 private fun captureIntent(intent:Intent){
  if(!intent.hasExtra("taskId")&&!intent.hasExtra("deepLink"))return
  val data=JSObject();for(key in listOf("kind","taskId","sessionId","deviceId","providerProfileId","deepLink")){intent.getStringExtra(key)?.let{data.put(key,it)};intent.removeExtra(key)}
  val store=activity.getSharedPreferences("companion-push",Context.MODE_PRIVATE);val pending=JSONArray(store.getString("pending","[]"));pending.put(data);while(pending.length()>20)pending.remove(0);store.edit().putString("pending",pending.toString()).commit();trigger("notification-tapped",data)
 }
 @Command fun takeNotifications(invoke:Invoke){val store=activity.getSharedPreferences("companion-push",Context.MODE_PRIVATE);val pending=JSONArray(store.getString("pending","[]"));store.edit().remove("pending").commit();invoke.resolve(JSObject().put("notifications",pending))}
 @Command fun requestPush(invoke:Invoke){
  val args=invoke.parseArgs(PushArgs::class.java)
  if(Build.VERSION.SDK_INT>=33&&getPermissionState("notifications").toString().lowercase()!="granted"){
   if(args.requestPermission)requestPermissionForAlias("notifications",invoke,"pushPermissionResult") else invoke.reject("Notifications are not authorized")
  }else fetchToken(invoke)
 }
 @PermissionCallback fun pushPermissionResult(invoke:Invoke){if(getPermissionState("notifications").toString().lowercase()=="granted")fetchToken(invoke)else invoke.reject("Notifications are disabled in system settings")}
 private fun fetchToken(invoke:Invoke){
  if(FirebaseApp.getApps(activity).isEmpty()){invoke.reject("Firebase is not configured; add this app’s google-services.json");return}
  FirebaseMessaging.getInstance().token.addOnCompleteListener{task->if(task.isSuccessful)invoke.resolve(JSObject().put("platform","fcm").put("token",task.result))else invoke.reject("FCM registration failed")}
 }
 private val alias="companion-auth"
 private val prefs get()=activity.getSharedPreferences("companion-auth",Context.MODE_PRIVATE)
 private fun key():SecretKey {
  val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
  (store.getKey(alias,null) as? SecretKey)?.let{return it}
  val generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore")
  generator.init(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
  return generator.generateKey()
 }
 @Command fun readAuth(invoke:Invoke){try{
  val encoded=prefs.getString("sealed",null)
  if(encoded==null){invoke.resolve(JSObject().put("value",""));return}
  val bytes=Base64.decode(encoded,Base64.NO_WRAP);require(bytes.size>12)
  val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,bytes.copyOfRange(0,12)))
  invoke.resolve(JSObject().put("value",String(cipher.doFinal(bytes.copyOfRange(12,bytes.size)),Charsets.UTF_8)))
 }catch(e:Exception){invoke.reject("Prompt Waypoint secure storage unavailable")}}
 @Command fun writeAuth(invoke:Invoke){try{
  val value=invoke.parseArgs(AuthArgs::class.java).value
  val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key())
  val sealed=Base64.encodeToString(cipher.iv+cipher.doFinal(value.toByteArray(Charsets.UTF_8)),Base64.NO_WRAP)
  check(prefs.edit().putString("sealed",sealed).commit());invoke.resolve()
 }catch(e:Exception){invoke.reject("Prompt Waypoint secure storage write failed")}}
 @Command fun clearAuth(invoke:Invoke){if(prefs.edit().clear().commit())invoke.resolve()else invoke.reject("Could not clear Prompt Waypoint auth")}
}
