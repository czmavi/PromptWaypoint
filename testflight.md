# PM.ai: připravenost na TestFlight a App Store

Datum analýzy: **14. 9. 2026**. Výchozí commit: `8f06b4f` (`server`). Rozsah:
iOS/iPadOS aplikace `apps/mobile` a server/agent, na kterých závisí. Mac App
Store ani Android nejsou součástí tohoto checklistu.

**Verdikt: veřejný App Store release zatím není připravený.** Základ aplikace,
build a automatické testy fungují, ale zbývají konkrétní opravy kompatibility,
privacy manifest, produkční způsob připojení a podklady pro review. Interní
TestFlight je blíž, stále však chybí ověřený podepsaný distribuční build.

Tento dokument doplňuje existující
[mobilní release návod](apps/mobile/TESTFLIGHT.md). Ten řeší především první
interní TestFlight; není dokladem připravenosti na veřejné vydání. Níže
rozlišuji nálezy v kódu, doporučení a externí stav, který nelze zjistit z
repozitáře. Do Apple účtu jsem nevstupoval, nic nenahrával ani nepublikoval.

## 1. Co je hotové a co jsem ověřil

| Oblast                    | Výsledek                                                                                                                                                                                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS identita              | `PM.ai`, bundle ID `com.caretsix.aiproductmanager`, verze `0.1.0`, build `1`. Zdrojem je [tauri.ios.conf.json](apps/mobile/src-tauri/tauri.ios.conf.json). Androidový identifikátor v základním configu není chyba iOS identity.                                     |
| Generování Xcode projektu | Vlastní [šablona](apps/mobile/src-tauri/ios/project.yml.hbs) zachovává identity, URL scheme `pmai`, automatic signing a rozdělení APNs development/production.                                                                                                       |
| Ikony                     | `ios:check` prošel; 18 položek ikon odpovídá zdrojům, rozměrům a RGB bez alpha kanálu, včetně 1024px App Store ikony.                                                                                                                                                |
| Frontend                  | `deno task --cwd apps/mobile build` prošel, včetně kontroly TypeScriptu a Vite produkčního buildu.                                                                                                                                                                   |
| Statické kontroly         | `deno check`, `deno lint` (108 souborů) a `deno fmt --check` (162 souborů před přidáním tohoto dokumentu) prošly.                                                                                                                                                    |
| Integrační testy          | `PMAI_TEST_PG_BIN=/opt/homebrew/opt/postgresql@15/bin deno task test:integration`: **92 passed, 0 failed**, včetně dočasného PostgreSQL, HTTP, SSE, WebSocket, MCP a server build/reload scénářů.                                                                    |
| Lokální toolchain         | Xcode **26.2**, build `17C52`; Deno **2.9.6**.                                                                                                                                                                                                                       |
| Existující archiv         | Na disku je `apps/mobile/src-tauri/gen/apple/build/mobile_iOS.xcarchive`. Jeho plist potvrzuje identitu, verzi/build, iOS minimum 15.0, iPhone+iPad a SDK `iphoneos26.2`. `codesign` potvrzuje: **code object is not signed at all**. Archiv jsem nově nesestavoval. |
| Offline a synchronizace   | Existují testy ukládání draftů, opakování požadavků se stejným ID, dvojitého Run/Resume/reply, oddělení profilů a směrování notifikací.                                                                                                                              |
| Token a push              | iOS plugin ukládá přihlašovací token do Keychain. Server implementuje APNs podpis `.p8` klíčem, cache JWT a frontu doručení.                                                                                                                                         |

První běh běžných testů v sandboxu skončil `74 passed / 1 failed / 17 ignored`:
WebSocket test nemohl otevřít lokální port a DB testy neměly databázi. Následný
kompletní integrační běh s povolenými lokálními porty prošel celý; nejde o
potvrzenou chybu aplikace.

**Neověřeno:** aktuální Apple Developer/App Store Connect konfigurace,
certifikáty, provisioning, upload, skutečný běh na iPhonu/iPadu, produkční
server a doručení APNs. Automatické UI testy používají `happy-dom`, ne iOS
WebView ani Swift bridge.

## 2. Prioritní přehled

P0 = vyřešit před příslušnou distribuční fází. P1 = oprava nebo ověření pro
veřejný release. P2 = následné zlepšení; není samo o sobě podmínkou prvního
vydání.

| Priorita | Zbývající práce                                            | Nejpozději před                         | Charakter                                         |
| -------- | ---------------------------------------------------------- | --------------------------------------- | ------------------------------------------------- |
| P0       | Privacy manifest a kontrola jeho zabalení                  | Prvním uploadem                         | Prokázaná mezera v projektu i existujícím archivu |
| P0       | Sladit minimum iOS s JavaScriptem/CSS                      | TestFlight distribucí na deklarované OS | Prokázaný nesoulad konfigurace a závislostí       |
| P0       | Podepsaný archive, export a processing v App Store Connect | TestFlight                              | Externí konfigurace a dosud neověřený výsledek    |
| P0       | Funkční HTTPS prostředí a přístup pro testery/review       | TestFlight / externím review            | Nasazení neověřeno                                |
| P0       | Produkční onboarding a vydávání tokenů                     | Veřejným App Store                      | V repu je pouze dev bootstrap                     |
| P0       | Privacy policy, support a informace o předávání dat AI     | Externím review / veřejným vydáním      | Chybí v UI a serverových routách                  |
| P0       | Review přístup, metadata, screenshoty, compliance          | Veřejným App Review                     | Stav v App Store Connect neověřen                 |
| P1       | Odpojení, obnova tokenu, mazání lokálních dat              | Veřejným vydáním                        | Konkrétní slabiny životního cyklu přihlášení      |
| P1       | Skutečné APNs, deep links a lifecycle testy                | Vydáním s notifikacemi                  | Implementace existuje, end-to-end ověření chybí   |
| P1       | UI branding, iPad, přístupnost a zařízení                  | Veřejným vydáním                        | Část nálezů v kódu, část ruční QA                 |
| P1       | Produkční provoz, diagnostika, zálohy a obnova             | Veřejným vydáním                        | Provozní připravenost neověřena                   |
| P2       | CI pro release, QR párování, další lokalizace              | Pozdějšími verzemi                      | Doporučení                                        |

## 3. Technické blokery v aplikaci

### 3.1 Chybí privacy manifest

**Důkaz:**
[CompanionNativePlugin.swift](apps/mobile/src-tauri/companion-native/ios/Sources/CompanionNativePlugin.swift)
používá `UserDefaults.standard` pro `companion.pending-notifications`. V
projektu ani v existujícím `.xcarchive` jsem nenašel `PrivacyInfo.xcprivacy`.
[Package.swift](apps/mobile/src-tauri/companion-native/ios/Package.swift) ani
Xcode šablona nezavádějí vlastní manifest resource.

Apple požaduje deklaraci použití required-reason API, včetně UserDefaults.
Samotná privacy policy ani App Privacy formulář ji nenahrazují.
[Apple: required reason API entries](https://developer.apple.com/documentation/technotes/tn3183-adding-required-reason-api-entries-to-your-privacy-manifest).

- [ ] Přidat manifest s `NSPrivacyAccessedAPICategoryUserDefaults` a
      odpovídajícím schváleným důvodem. Pro vlastní data aplikace prověřit
      `CA92.1`; nepřebírat důvody pro API, která aplikace nepoužívá.
- [ ] Prověřit také skutečně linkované Rust/Tauri/Swift závislosti a ostatní
      required-reason API; pouze UserDefaults nemusí být kompletní inventář.
- [ ] Zařídit kopírování do výsledné aplikace trvale přes zdrojovou konfiguraci,
      nikoli jednorázovou úpravou generovaného projektu.
- [ ] Doplnit kontrolu zabaleného manifestu do release validace. Stávající
      `ios:check` kontroluje konfiguraci a ikony, manifest neřeší.

**Hotovo, když:** manifest přežije `tauri ios init`, je ve finálním distribučním
balíčku a App Store Connect nehlásí chybějící nebo neplatné deklarace API.

### 3.2 Deklarované iOS 15.0 neodpovídá frontendovému runtime

**Důkaz:** minimum 15.0 je v obou Tauri konfiguracích, Swift package a
kontrolním skriptu. [vite.config.ts](apps/mobile/vite.config.ts) nemá explicitní
`build.target`. Používá se Vite 7 a Tailwind 4. V
[native.ts](apps/mobile/src/native.ts) je nepodmíněné
`AbortSignal.timeout(15000)`; aplikace dále používá `structuredClone` a
`crypto.randomUUID`. Produkční JS stále obsahuje volání `AbortSignal.timeout`,
ne jeho náhradu.

Vite 7 standardně cílí Safari 16 a nedoplňuje automaticky polyfilly webových
API. Tailwind 4 deklaruje minimum Safari 16.4. `structuredClone` přibylo v
Safari 15.4. To znamená, že úspěšný build s deployment targetem 15.0 nepotvrzuje
funkční UI na iOS 15.0. Jde o staticky doložený nesoulad; pád na zařízení jsem
nereprodukoval. [Vite 7](https://v7.vite.dev/guide/build),
[Tailwind compatibility](https://tailwindcss.com/docs/compatibility),
[WebKit 15.4](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/).

- [ ] Doporučená cesta: zvolit skutečně podporované minimum, alespoň iOS 16.4
      jako výchozí kandidát pro současné závislosti, a ověřit ho na
      zařízení/WebView. Sladit Tauri configy, Swift package, `ios-check`,
      dokumentaci a generovaný projekt; nastavit explicitní JS/CSS target.
- [ ] Pokud má zůstat iOS 15, doplnit náhrady nepodporovaných API a kompatibilní
      CSS/build. Samotné snížení Vite targetu chybějící runtime API nevyřeší.
- [ ] Otestovat cold start, připojení, capture, push a obnovu tokenu na nejnižší
      podporované verzi OS.

**Hotovo, když:** distribuovaný balíček lze bez JS chyb a rozbitého layoutu
použít na nejstarším deklarovaném OS. Build SDK a minimální podporovaný OS jsou
dvě různé věci.

### 3.3 Přihlášení a práce s lokálními daty

**Důkazy:** [App.tsx](apps/mobile/src/App.tsx),
[native.ts](apps/mobile/src/native.ts),
[store.ts](apps/mobile/src/model/store.ts),
[API logout](apps/server/routes/api/routes.ts).

- [ ] **Odpojení při nedostupném serveru / expirovaném tokenu:** UI před
      smazáním Keychain a cache čeká na `removePush`. Pokud registrace existuje
      a požadavek selže, lokální odpojení se nedokončí. Doplnit explicitní
      nouzové vymazání s vysvětlením dopadu na neodeslané změny a vzdálenou
      registraci.
- [ ] **Odstranit staré cache po obnově tokenu:** scope cache je hash
      URL+tokenu. `renewAuth` kopíruje data do nového scope, starý
      `localStorage` záznam ale neodstraňuje. Následné odpojení maže pouze
      aktuální scope. Ošetřit atomické předání dat a úklid starých cache;
      nevymazat jedinou kopii draftů při chybě.
- [ ] **Ověřit identitu při obnově:** kontrola stejného workspace dnes vychází z
      `snapshot.devices[].userId`. Prázdný seznam zařízení není spolehlivý
      identifikátor účtu. Použít serverem potvrzenou identitu a ověřit, že nelze
      přenést drafty mezi různými účty při obnově tokenu.
- [ ] **Rozlišit disconnect a logout:** server má `/api/auth/logout`, ale
      mobilní odpojení jej nevolá. Rozhodnout, zda má jít pouze o lokální
      odpojení, nebo revokaci session. Při případné revokaci počítat s tím, že
      ručně zkopírovaný token může používat i jiný klient; vhodnější jsou tokeny
      pro konkrétní relaci.
- [ ] **Recovery poškozeného/velkého úložiště:** `MobileStore.read` přímo
      parsuje JSON, `write` neřeší vyčerpání kvóty. Doplnit verzování, bezpečný
      recovery postup a srozumitelné chyby bez tichého zahození neodeslaných
      úkolů.

**Hotovo, když:** je otestované připojení → obnova tokenu → restart → odpojení,
včetně offline, 401, prázdného účtu a pending změn; po úplném lokálním vymazání
nezůstávají staré cache ani čekající nativní notifikace daného workspace.

## 4. Produkční služba a onboarding

### 4.1 Rozhodnout a dokončit model přístupu

Mobil dnes vyžaduje URL serveru a ručně vložený token. Jediný dodaný login
endpoint je `/api/auth/dev-login`: vytváří pevného uživatele `dev-user`,
klientský token má platnost 30 dní. Produkční login/registrace ani samoobslužné
získání nového tokenu nejsou implementované. Multi-user datový model sám o sobě
není hotový onboarding. [Auth implementace](apps/server/src/auth/auth.ts),
[serverový návod](apps/server/README.md).

- [ ] Zvolit, zda první release slouží existujícím uživatelům vlastního serveru,
      nebo nabízí veřejnou hostovanou službu.
- [ ] Pro vlastní server dodat dostupný instalační/párovací návod a bezpečný
      způsob vydání, obnovy a revokace tokenů. V UI vysvětlit, odkud získat URL
      a token a že je nutný Local Agent na počítači.
- [ ] Pro veřejnou službu dokončit izolované účty, produkční autentizaci, obnovu
      přístupu a párování počítače. Nevydávat všem zákazníkům tokeny jednoho
      `dev-user` ani společný bootstrap secret.
- [ ] Doplnit praktický prázdný stav: co udělat bez zařízení, repozitáře a
      profilu. Pro běžného uživatele nesmí cesta končit pouze u prázdného
      seznamu.

Ručně zadaný token není automatický důvod k odmítnutí. Je ale potřeba dokončený
produktový postup, který zvládne cílový uživatel i reviewer.

### 4.2 Připravit nasazení a provoz

- [ ] Zajistit stabilní veřejné HTTPS prostředí, platný certifikát, PostgreSQL a
      dosažitelnost z mobilních dat. Ověřit API, SSE a agent WebSocket přes
      skutečný reverse proxy; produkční CORS musí povolit reálný origin iOS
      WebView.
- [ ] Připravit izolované prostředí pro review s online agentem a bezpečným
      repozitářem. Udržet ho dostupné po celou dobu review a zajistit, aby token
      během posuzování neexpiroval.
- [ ] Dokumentovat nasazení, migrace, restart, správu secretů a zálohy;
      prakticky ověřit obnovu DB. `/health` existuje, ale provozní monitoring
      nebyl ověřen.
- [ ] Sbírat bezpečné chyby serveru a doručování push, nastavit základní alerty.
      Uchovat dSYM pro konkrétní release kvůli symbolikaci iOS crashů. Externí
      analytické/crash SDK není nutné; jeho případné přidání promítnout do
      privacy.
- [ ] Stanovit retention pro úkoly, sessions, historii a push jobs. Archivace či
      smazání úkolu dnes záměrně může zachovat execution history; neprezentovat
      to jako úplné smazání všech osobních údajů.

## 5. Privacy, review a obchodní model

### 5.1 Veřejné dokumenty a App Privacy

V mobilním Settings ani na připojovací obrazovce nejsou odkazy na privacy policy
a podporu. Server registruje marketingovou stránku, ale ne privacy/support
routy. Je možné, že externí stránky existují mimo repo; jejich adresy ani obsah
nebyly ověřeny.

- [ ] Zveřejnit Privacy Policy na stabilní URL a zpřístupnit ji také uvnitř
      appky, ideálně ještě před připojením. Uvést provozovatele, kontakt,
      příjemce dat, účely, dobu uchování a způsob výmazu. Apple vyžaduje privacy
      policy a údaje o praxi aplikace v App Store Connect.
      [Apple App Privacy](https://developer.apple.com/app-store/app-privacy-details/).
- [ ] Připravit Support URL s funkčním kontaktem a návodem na připojení/obnovu.
      Rozhodnout mezi standardní Apple EULA a vlastními podmínkami služby.
- [ ] Vyplnit App Privacy podle finálního nasazení. Kandidáty k posouzení jsou
      obsah úkolů/prompty, odpovědi agenta, názvy a cesty repozitářů, metadata
      sessions, ID uživatele/zařízení, push token a případné provozní logy.
      Rozlišit data jen v telefonu, data u provozovatele vlastního serveru a
      data dostupná vydavateli/jeho partnerům; neoznačovat automaticky „Data Not
      Collected“ jen proto, že provider credentials zůstávají na počítači.
- [ ] Sepsat skutečný datový tok: telefon → server → Local Agent → zvolený AI
      provider; výsledky zpět, metadata notifikací také přes APNs. To je podklad
      pro policy a formulář, nikoli hotová právní klasifikace všech dat.

### 5.2 Předávání dat AI a smazání účtu

- [ ] Před předáním osobních údajů třetím stranám včetně AI jasně vysvětlit
      příjemce a získat výslovný souhlas. V UI jsem nenašel takové vysvětlení;
      samotný ProviderBadge a tlačítko Run nejsou doloženým informovaným
      souhlasem. Návrh: srozumitelné vysvětlení při připojení/prvním spuštění a
      záznam souhlasu pro příslušného poskytovatele. Server a vlastní Local
      Agent zahrnout do celého toku.
      [App Review 5.1.2(i)](https://developer.apple.com/app-store/review/guidelines/#data-use-and-sharing).
- [ ] Pokud finální produkt umožní vytvářet účty, umožnit zahájit jejich
      odstranění z aplikace a realizovat výmaz navázaných dat podle deklarované
      politiky. Dnešní „Disconnect & clear this phone’s cache“ nemaže serverový
      účet. U čistého klienta k existujícímu serveru nejprve vyhodnotit
      použitelnost požadavku; samotná absence registrační obrazovky není
      univerzální výjimka.
      [Apple: account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/).

### 5.3 Monetizace a přístup pro Apple

- [ ] Pro první verzi potvrdit bezplatný nebo placený model. StoreKit/IAP zde
      implementované nejsou. Bezplatný companion může za splnění podmínek
      fungovat bez IAP; při prodeji digitálních funkcí/předplatného je potřeba
      znovu posoudit platební pravidla. Nedoplňovat automaticky nákupní webový
      odkaz.
      [App Review 3.1.3(f)](https://developer.apple.com/app-store/review/guidelines/#other-purchase-methods).
- [ ] Pro App Review dodat funkční URL a token, kontakt a krátký postup:
      připojení → vytvoření úkolu → Run/Queue → waiting input → dokončení →
      push. Zahrnout připravený agent a repozitář, aby reviewer nemusel
      instalovat CLI a pořizovat vlastní AI předplatné. Demo režim je
      alternativní řešení, není automaticky povinnou funkcí.
- [ ] V review notes popsat, že appka ovládá agenta na uživatelově počítači; kód
      se nespouští ani neinstaluje v iOS a provider credentials nejsou v mobilu.
      To objasňuje architekturu při posuzování pravidel spouštění kódu.

U tokenového přihlášení není samo o sobě nutné přidávat Sign in with Apple.
Pokud se přidá sociální login, přehodnotit pravidlo 4.8. Stejně tak bez
sledování uživatele není důvod automaticky přidávat ATT dialog. CMD/AI produkty
ani soukromý task list samy o sobě nevyžadují sociální moderaci. Posouzení
změnit, pokud se rozšíří funkce.
[App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).

## 6. Apple účet, podpis a distribuční build

Stav účtu je **neověřený**, nikoli prokázaně chybějící. Chybějící Team ID v gitu
je v pořádku; certifikáty, `.p8` a hesla do repozitáře nepatří.

- [ ] Aktivní Apple Developer Program, správná role pro upload a přijaté
      smlouvy.
- [ ] Explicitní App ID `com.caretsix.aiproductmanager` s Push Notifications.
- [ ] App Store Connect záznam pro PM.ai: bundle ID, SKU, primární jazyk.
- [ ] Signing Team přes `APPLE_DEVELOPMENT_TEAM`/lokální konfiguraci,
      distribution certifikát a odpovídající provisioning profile.
- [ ] Nastavit marketingovou verzi a jedinečný build number. `0.1.0` není samo o
      sobě technický blocker; `1.0.0` je produktová volba. Pokud se změní
      marketingová verze, upravit i hardcoded očekávání `0.1.0` v
      `ios-check.ts`.
- [ ] Sestavit nový podepsaný Release archive z finálního commitu, validovat a
      exportovat metodou **`app-store-connect`**. Stávající unsigned archiv není
      distribuční artefakt. `debugging` ani `release-testing` export není App
      Store upload.
- [ ] Zkontrolovat finální podpis/entitlements: správné Team ID a application
      ID, `aps-environment=production`, pro distribuční balíček vypnuté
      `get-task-allow`; zkontrolovat i výsledek případného re-signingu při
      exportu.
- [ ] Znovu potvrdit export compliance podle skutečných závislostí. Aktuální
      template uvádí `ITSAppUsesNonExemptEncryption=false`; existující rozbor je
      v mobilním návodu, při změně kryptografie ho aktualizovat.
- [ ] Upload a dokončený processing v App Store Connect bez nevyřešených chyb.

Od 28. 4. 2026 požaduje Apple pro upload iOS/iPadOS SDK 26 nebo novější. Lokální
Xcode 26.2 a nalezený archiv s SDK 26.2 toto minimum splňují; před skutečným
uploadem znovu ověřit aktuální podmínky. Neznamená to požadavek na minimum iOS
26 pro uživatele.
[Apple SDK requirements](https://developer.apple.com/news/?id=ueeok6yw).

### Reprodukovatelné příkazy

Z kořene repozitáře, po provedení oprav:

```sh
deno install
deno fmt --check
deno lint
deno check
PMAI_TEST_PG_BIN=/opt/homebrew/opt/postgresql@15/bin deno task test:integration
deno task --cwd apps/mobile build
```

Z `apps/mobile`, s lokálně nastaveným podpisem a skutečným Team ID:

```sh
deno task tauri ios init --ci
deno task ios:icons:sync
deno task ios:check
deno task ios:release
# Alternativně explicitní export po konfiguraci signing:
deno task ios:export
```

Po regeneraci zkontrolovat diff projektu. `ios:icons:sync` je před samostatným
`ios:check` uvedeno záměrně, aby kontrola nečetla neobnovený asset catalog.

## 7. APNs a testování na zařízení

Serverová konfigurace pro TestFlight i App Store:

```text
PMAI_APNS_KEY_FILE=<cesta k bezpečně připojenému .p8 souboru>
PMAI_APNS_KEY_ID=<Apple Key ID>
PMAI_APNS_TEAM_ID=<Apple Team ID>
PMAI_APNS_TOPIC=com.caretsix.aiproductmanager
PMAI_APNS_SANDBOX=false
```

- [ ] Ověřit skutečné doručení na instalaci z TestFlight; úspěšné získání tokenu
      ani serverová registrace nedokazují doručení. TestFlight používá produkční
      APNs. Debug prostředí se sandboxem držet odděleně.
- [ ] Otestovat všechny čtyři stavy: completed, failed, waiting input, resumed;
      popředí, pozadí, ukončená aplikace, zamčený telefon a cold-start tap.
- [ ] Ověřit odmítnuté oprávnění, jeho pozdější zapnutí v Settings, rotaci
      tokenu, reconnect a odpojení účtu. Tap smí otevřít správný task/session,
      ne spustit příkaz nebo ukázat data jiného účtu.
- [ ] Prověřit reálný HTTP/2 transport APNs přes nasazený Deno runtime/proxy.
      Současné testy provideru mockují `fetch`, netestují Apple endpoint.
- [ ] Doplnit rozlišení trvalých a dočasných chyb doručení. Dnes
      [providers.ts](apps/server/src/push/providers.ts) redukuje chybu na status
      a [queue.ts](apps/server/src/push/queue.ts) neúspěch stále opakuje.
      Ošetřit zneplatněné tokeny, omezení retry a diagnostiku bez úniku
      citlivých údajů.

Bez spolehlivého push lze vydat pouze vědomě upravený produkt, který notifikace
nenabízí ani neslibuje. V současném UI jsou součástí funkcí.

## 8. UI a ruční akceptační testy

- [ ] **Branding:** uvnitř appky je stále `Companion` (welcome, Settings a HTML
      title), přestože systémová identita je PM.ai. Sjednotit uživatelské texty,
      název a branding před pořizováním screenshotů. Interní název Rust targetu
      `mobile_iOS` není potřeba přejmenovávat.
- [ ] **iPad:** vygenerovaný projekt i archiv mají `UIDeviceFamily = [1, 2]`.
      iPad je tedy aktuálně podporovaný. UI má maximální šířku 560px; ověřit
      portrait/landscape, změny velikosti a klávesnici. Případné omezení jen na
      iPhone musí být záměrná trvalá změna konfigurace před prvním releasem.
- [ ] **Přístupnost:** VoiceOver, pořadí focusu, názvy ikonových tlačítek,
      zvětšený text, kontrast a ovládání bez rozlišování barvy. V CSS jsou malé
      texty 9–11px a několik menších ovládacích ploch; reálnou čitelnost ověřit.
- [ ] **Layout:** menší iPhone, velký iPhone, safe areas, otevřená klávesnice,
      dlouhé názvy repo/úkolů, multiline prompt, velký počet úkolů a prázdné
      stavy.
- [ ] **Síť a autorizace:** čistá instalace, špatný token, 401 po expiraci,
      neplatná URL/certifikát, offline start, přepnutí Wi-Fi/mobilní data,
      background/foreground a nedostupný Local Agent.
- [ ] **Data a příkazy:** vytvořit/editovat offline, zavřít appku a
      dosynchronizovat; dvojitý Run/Resume/reply, ztracená odpověď serveru,
      konfliktní/rejected změna, zrušený task a deep link na nedostupnou
      session.
- [ ] **Upgrade:** instalace nové verze přes předchozí TestFlight build musí
      zachovat přihlášení, drafty a pending frontu. Ověřit migrace úložiště.
- [ ] **Výkon/stabilita:** delší běh, návrat po uspání, paměť, spotřeba při SSE
      reconnectu; projít crash logy konkrétního release kandidáta.

Ke každému scénáři uložit zařízení, OS, verzi/build a výsledek. Aktuálně takový
protokol pro iOS release v repu není doložen.

## 9. App Store listing a distribuční fáze

### Podklady pro veřejné vydání

- [ ] Finální název, popis, subtitle podle potřeby, keywords, kategorie,
      copyright, kontakty a primární jazyk. Texty mají odpovídat dodaným funkcím
      a vysvětlit závislost na serveru a počítači s agentem.
- [ ] Screenshoty skutečné finální aplikace: Home, capture, task detail/waiting
      input, zařízení/projekty. Připravit povinné rozměry pro deklarované rodiny
      zařízení včetně iPadu, pokud zůstává podporovaný. Nepoužívat reálné
      citlivé úkoly. Video preview je volitelné.
      [Apple screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).
- [ ] Dokončit age-rating dotazník podle reálného přístupu k obsahu/AI;
      nenastavovat hodnocení odhadem jen podle označení „task manager“.
- [ ] Vyplnit App Privacy, Privacy Policy URL, Support URL a App Review
      informace. Accessibility tvrzení uvádět jen pro ověřené vlastnosti.
- [ ] Vybrat cenu, země a datum/způsob vydání. Pro první verzi doporučuji
      manuální release po schválení, aby bylo možné sladit dostupnost backendu.
- [ ] Pro EU vyřešit trader/non-trader status a případné ověření kontaktních
      údajů. Bezplatnost sama neurčuje, že vydavatel není trader.
      [Apple DSA requirements](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements).
- [ ] Vědomě nastavit dostupnost iOS aplikace na Apple Silicon Mac a Vision Pro;
      další platformy nejprve prověřit nebo jejich distribuci vypnout.
      [Apple submission guide](https://developer.apple.com/app-store/submitting/).
- [ ] Ověřit oprávnění používat branding/assety a třetí služby; uchovat přehled
      licencí závislostí a jejich požadovaných notices.

### A. Interní TestFlight

Dokončit technické P0, podpis a processing; dodat testovací prostředí, „What to
Test“ a interní skupinu. Interní testeři jsou oprávnění uživatelé App Store
Connect, nikoli libovolní zákazníci. Interní testování zpravidla nevyžaduje Beta
App Review.
[Apple internal testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers).

Pokud má stejný build pokračovat k veřejnému vydání, uploadovat přes App Store
Connect a nevolit **TestFlight Internal Only**: takto omezený build nelze použít
pro externí testování ani App Store.
[Apple beta workflow](https://developer.apple.com/tutorials/develop-in-swift/test-your-beta-app).

### B. Externí TestFlight

Připravit beta informace a review přístup, splnit relevantní privacy/review
požadavky, vytvořit externí skupinu a projít Beta App Review prvního buildu.
Teprve potom rozšířit testování na externí uživatele.
[Apple TestFlight](https://developer.apple.com/testflight/).

### C. Veřejný App Store

Vybrat otestovaný build, uzavřít checklist produktových P0/P1, doplnit listing a
compliance, podat k App Review, vyřešit připomínky a teprve po schválení vydat.
Schválení externí bety není schválením veřejné App Store verze.

## 10. Doporučené pořadí realizace

1. **Kód:** privacy manifest, minimum iOS/runtime, bezpečné odpojení a obnova
   tokenu, recovery úložiště, jednotný PM.ai branding.
2. **Produkt a data:** rozhodnout model serveru a účtů, dokončit onboarding,
   privacy/support stránky, informování o AI a potřebný souhlas, podmíněně výmaz
   účtu a monetizaci.
3. **Provoz a Apple konfigurace:** review prostředí, signing, APNs, verze/build,
   nový archive, validace a upload.
4. **Interní TestFlight:** ověřit zařízení, podporované OS, push a
   offline/lifecycle scénáře; opravit zjištěné problémy.
5. **Externí beta a listing:** ověřit onboarding s dalšími uživateli, pořídit
   finální screenshoty a dokončit metadata, rating a compliance.
6. **App Review a vydání:** předat funkční review přístup, vybrat prověřený
   build, schválit veřejné spuštění a sledovat chyby i backend.

QR párování, speech capture, share extension, další jazyky a release CI mohou
následovat později. Mikrofon/speech oprávnění pro současný MVP nepřidávat,
protože tyto funkce implementované nejsou. Rozsah prvního vydání lze udržet
malý, ale musí být funkční, vysvětlitelný a ověřený na deklarovaných zařízeních.
