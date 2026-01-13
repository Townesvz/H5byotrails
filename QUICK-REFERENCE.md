# 🚀 PWA QUICK REFERENCE CARD

## ⚡ SNELLE INSTALLATIE (5 minuten)

### 1️⃣ BESTANDEN PLAATSEN
```
hike5-byo-planner/
├── manifest.json              ← Root
├── service-worker.js          ← Root  
├── index.html                 ← Vervang
├── pwa-styles.css             ← Root of public/
└── src/
    ├── PWAInstallButton.jsx   ← Nieuwe component
    └── OfflineIndicator.jsx   ← Nieuwe component
```

### 2️⃣ ICONS (KAN LATER!)
Maak folder: `/public/icons/`  
Plaats 8 PNG icons (72px tot 512px)  
**OF skip dit voor nu - werkt ook zonder!**

### 3️⃣ COMPONENTS TOEVOEGEN
```jsx
// In main.jsx:
import PWAInstallButton from './PWAInstallButton';
import OfflineIndicator from './OfflineIndicator';

function App() {
  return (
    <>
      <OfflineIndicator />
      <YourApp />
      <PWAInstallButton />
    </>
  );
}
```

### 4️⃣ CSS TOEVOEGEN
In `index.html` head:
```html
<link rel="stylesheet" href="/pwa-styles.css" />
```

### 5️⃣ DEPLOY!
ZIP → Netlify → KLAAR! ✅

---

## 📱 TESTEN OP iPHONE

**Installeren:**
1. Open in Safari
2. Tap groene "Installeer" banner
3. Of: Share → "Zet op beginscherm"
4. ✅ App op home screen!

**Offline testen:**
1. Open app
2. Bezoek trail
3. Vliegtuigmodus aan ✈️
4. Refresh
5. ✅ Werkt nog!

---

## 🔧 BELANGRIJKE PATHS

```javascript
// Manifest location
<link rel="manifest" href="/manifest.json" />

// Service worker registration  
navigator.serviceWorker.register('/service-worker.js')

// Icons location
/public/icons/icon-192x192.png
```

---

## ⚠️ COMMON ISSUES

| Probleem | Oplossing |
|----------|-----------|
| Install button verschijnt niet | Open in Safari (niet Chrome!) |
| Offline werkt niet | Bezoek pagina eerst, dan offline |
| Icons missing | Skip voor nu, werkt ook zonder |
| CSS niet geladen | Check path in index.html |

---

## 🎨 SNEL AANPASSEN

**Kleuren:**
```json
// manifest.json
"theme_color": "#22c55e"  ← Wijzig hier
```

**Teksten:**
```jsx
// PWAInstallButton.jsx, regel ~54
<h3>Installeer Hike5</h3>  ← Wijzig hier
```

---

## 📋 CHECKLIST

Deploy klaar? Check dit:
- [ ] Alle files geüpload
- [ ] Components toegevoegd
- [ ] CSS linked in index.html
- [ ] Site opent op phone
- [ ] Install banner verschijnt
- [ ] Offline mode werkt

---

## 💾 FILE SIZES

```
manifest.json        ~1 KB
service-worker.js    ~8 KB
PWAInstallButton     ~2 KB
OfflineIndicator     ~1 KB
pwa-styles.css       ~6 KB
---
Totaal:             ~18 KB (niks!)
```

---

## 🎯 VOOR FISHERMAN'S TRAIL

**Voorbereiden:**
1. Installeer app op phone
2. Open alle trails
3. Laat data laden
4. Test offline in hotel

**Tijdens wandelen:**
- GPS werkt (hardware!)
- Data uit cache
- Screenshots maken
- Bugs noteren

---

## 🚀 NEXT LEVEL (Later)

```javascript
// Push notifications
self.registration.showNotification()

// Background sync  
self.addEventListener('sync')

// Share API
navigator.share()
```

---

## 📞 HULP?

**Errors?** → Screenshot + console log  
**Werkt niet?** → Browser? Device?  
**Vragen?** → Vraag me!

---

*Quick ref v1.0 - Jan 2026* 🔥
