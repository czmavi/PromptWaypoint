import Tauri
import Security
import Foundation
import UIKit
import WebKit
import UserNotifications
import ObjectiveC
class AuthArgs: Decodable { let value: String }
class PushArgs:Decodable { let requestPermission:Bool }
class CompanionNativePlugin: Plugin {
 static weak var instance:CompanionNativePlugin?
 private var tokenRequests:[Invoke]=[]
 override public func load(webview:WKWebView){ Self.instance=self; PushBridge.install(); }
 @objc public func requestPush(_ invoke:Invoke) throws {
  let args=try invoke.parseArgs(PushArgs.self)
  let register:()->Void={DispatchQueue.main.async{self.tokenRequests.append(invoke);PushBridge.install();UIApplication.shared.registerForRemoteNotifications();DispatchQueue.main.asyncAfter(deadline:.now()+20){if let i=self.tokenRequests.firstIndex(where:{$0 === invoke}){self.tokenRequests.remove(at:i);invoke.reject("APNs registration timed out")}}}}
  UNUserNotificationCenter.current().getNotificationSettings{settings in
   if settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional {register()}
   else if args.requestPermission {UNUserNotificationCenter.current().requestAuthorization(options:[.alert,.badge,.sound]){granted,_ in if granted{register()}else{invoke.reject("Notifications are disabled in system settings")}}}
   else {invoke.reject("Notifications are not authorized")}
  }
 }
 func receivedToken(_ data:Data){let token=data.map{String(format:"%02x",$0)}.joined();let requests=tokenRequests;tokenRequests=[];requests.forEach{$0.resolve(["platform":"apns","token":token])};try? trigger("token-received",data:["token":token,"platform":"apns"])}
 func tokenError(){let requests=tokenRequests;tokenRequests=[];requests.forEach{$0.reject("APNs registration failed; check signing and push entitlement")}}
 @objc public func takeNotifications(_ invoke:Invoke){let pending=UserDefaults.standard.array(forKey:"companion.pending-notifications") as? [[String:String]] ?? [];UserDefaults.standard.removeObject(forKey:"companion.pending-notifications");invoke.resolve(["notifications":pending])}

 private let service = "com.caretsix.aiproductmanager.companion-auth"
 private var query: [String: Any] { [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:"companion"] }
 @objc public func readAuth(_ invoke: Invoke) {
  var q=query;q[kSecReturnData as String]=true;q[kSecMatchLimit as String]=kSecMatchLimitOne
  var result:CFTypeRef?;let status=SecItemCopyMatching(q as CFDictionary,&result)
  if status==errSecItemNotFound {invoke.resolve(["value":""]);return}
  guard status==errSecSuccess,let data=result as? Data,let value=String(data:data,encoding:.utf8) else {invoke.reject("Prompt Waypoint Keychain read failed: \(status)");return}
  invoke.resolve(["value":value])
 }
 @objc public func writeAuth(_ invoke: Invoke) throws {
  let args=try invoke.parseArgs(AuthArgs.self)
  let attributes:[String:Any]=[kSecValueData as String:Data(args.value.utf8),kSecAttrAccessible as String:kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
  var status=SecItemUpdate(query as CFDictionary,attributes as CFDictionary)
  if status==errSecItemNotFound {var q=query;attributes.forEach{q[$0.key]=$0.value};status=SecItemAdd(q as CFDictionary,nil)}
  guard status==errSecSuccess else {invoke.reject("Prompt Waypoint Keychain write failed: \(status)");return};invoke.resolve()
 }
 @objc public func clearAuth(_ invoke: Invoke) {let status=SecItemDelete(query as CFDictionary);if status==errSecSuccess||status==errSecItemNotFound{invoke.resolve()}else{invoke.reject("Prompt Waypoint Keychain delete failed: \(status)")}}
}
@_cdecl("init_plugin_companion_native")
func initPlugin()->Plugin { UNUserNotificationCenter.current().delegate=PushBridge.shared;return CompanionNativePlugin() }

// Tao owns UIApplicationDelegate. Add the two APNs callbacks without replacing its lifecycle methods.
private class PushBridge:NSObject,UNUserNotificationCenterDelegate {
 static let shared=PushBridge();static var installed=false
 static func install(){
  UNUserNotificationCenter.current().delegate=shared
  guard !installed,let delegate=UIApplication.shared.delegate else{return}
  let cls:AnyClass=type(of:delegate)
  let received:@convention(block)(AnyObject,UIApplication,NSData)->Void={_,_,data in CompanionNativePlugin.instance?.receivedToken(data as Data)}
  let failed:@convention(block)(AnyObject,UIApplication,NSError)->Void={_,_,_ in CompanionNativePlugin.instance?.tokenError()}
  let tokenAdded=class_addMethod(cls,NSSelectorFromString("application:didRegisterForRemoteNotificationsWithDeviceToken:"),imp_implementationWithBlock(received as Any),"v@:@@")
  let errorAdded=class_addMethod(cls,NSSelectorFromString("application:didFailToRegisterForRemoteNotificationsWithError:"),imp_implementationWithBlock(failed as Any),"v@:@@")
  installed=tokenAdded&&errorAdded
 }
 private func payload(_ value:[AnyHashable:Any])->[String:String]{var result:[String:String]=[:];for key in ["kind","taskId","sessionId","deviceId","providerProfileId","deepLink"]{if let text=value[key] as? String{result[key]=text}};return result}
 func userNotificationCenter(_ center:UNUserNotificationCenter,willPresent notification:UNNotification,withCompletionHandler done:@escaping(UNNotificationPresentationOptions)->Void){try? CompanionNativePlugin.instance?.trigger("notification-received",data:payload(notification.request.content.userInfo));done([.banner,.sound])}
 func userNotificationCenter(_ center:UNUserNotificationCenter,didReceive response:UNNotificationResponse,withCompletionHandler done:@escaping()->Void){let data=payload(response.notification.request.content.userInfo);var pending=UserDefaults.standard.array(forKey:"companion.pending-notifications") as? [[String:String]] ?? [];pending.append(data);UserDefaults.standard.set(Array(pending.suffix(20)),forKey:"companion.pending-notifications");try? CompanionNativePlugin.instance?.trigger("notification-tapped",data:data);done()}
}
