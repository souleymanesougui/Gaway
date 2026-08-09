import { db, auth, provider, RecaptchaVerifier, signInWithPhoneNumber } from './firebase.js';
import {
  doc,
  getDoc,
  updateDoc,
  setDoc,
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  increment,
  onSnapshot,
  serverTimestamp,
  where,
  writeBatch
} from "firebase/firestore";
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  PhoneAuthProvider,
  signInWithCredential
} from "firebase/auth";

let currentUser = null;      // admin/proprietaire
let firebaseUser = null;    // utilisateur Firebase (Google ou téléphone)
let passwords = {
  admin: "admin123",
  editor: "editor123"
};

let journalEntries = [];
let family = null;
let history = [];
let currentPath = [];
let currentNode = null;
let lastDetailPerson = null;

let familyHistory = "La lignée des <strong>fils Gaida</strong> est une famille dont les racines plongent au coeur des traditions et de l'histoire. Ce site a été créé pour préserver la mémoire et l'arbre généalogique de cette famille, afin que chaque génération puisse connaître ses origines et son héritage.\n\n— Que la mémoire de nos ancêtres vive à travers nous.";

// = STATISTIQUES =
const statsRef = doc(db, "stats", "siteStats");
const presenceRef = collection(db, "presence");
const sessionId = crypto.randomUUID();

function getWeekKey() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now - start) / 86400000);
  const week = Math.ceil((days + start.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(week).padStart(2,'0')}`;
}
function getMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
}

async function registerVisit() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const weekKey = getWeekKey();
    const monthKey = getMonthKey();
    await updateDoc(statsRef, {
      totalVisits: increment(1),
      [`dailyVisits.${today}`]: increment(1),
      [`weeklyVisits.${weekKey}`]: increment(1),
      [`monthlyVisits.${monthKey}`]: increment(1)
    });
  } catch (error) {
    console.error("Erreur enregistrement visite:", error);
  }
}

async function registerPresence() {
  try {
    const sessionDoc = doc(presenceRef, sessionId);
    await setDoc(sessionDoc, {
      sessionId: sessionId,
      timestamp: serverTimestamp()
    });
    console.log("🟢 Présence enregistrée pour :", sessionId);
  } catch (error) {
    console.error("❌ Erreur enregistrement présence:", error);
  }
}

async function updateHeartbeat() {
  try {
    const sessionDoc = doc(presenceRef, sessionId);
    await updateDoc(sessionDoc, {
      timestamp: serverTimestamp()
    });
    console.log("Heartbeat envoyé pour :", sessionId);
  } catch (error) {
    console.warn("Heartbeat échoué, recréation de la session...", error);
    await registerPresence();
  }
}

async function cleanOldSessions() {
  try {
    const twoMinAgo = new Date(Date.now() - 100000);
    console.log("🧹 Nettoyage des sessions avant :", twoMinAgo.toISOString());
    const q = query(presenceRef, where("timestamp", "<", twoMinAgo));
    const snap = await getDocs(q);
    console.log(`📄 ${snap.size} sessions obsolètes trouvées.`);
    if (snap.empty) return;
    const batch = writeBatch(db);
    snap.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    console.log(`✅ ${snap.size} sessions supprimées.`);
  } catch (error) {
    console.error("❌ Erreur nettoyage sessions:", error);
  }
}

async function countLiveVisitors() {
  await cleanOldSessions();
  const snap = await getDocs(presenceRef);
  return snap.size;
}

async function registerDownload() {
  try {
    await updateDoc(statsRef, {
      totalDownloads: increment(1)
    });
  } catch (error) {
    console.error("Erreur enregistrement téléchargement:", error);
  }
}

function displayStats() {
  onSnapshot(statsRef, (docSnap) => {
    if (docSnap.exists()) {
      const data = docSnap.data();
      document.getElementById('totalVisits').textContent = data.totalVisits || 0;
      document.getElementById('totalDownloads').textContent = data.totalDownloads || 0;
      const today = new Date().toISOString().split('T')[0];
      document.getElementById('todayVisits').textContent = data.dailyVisits?.[today] || 0;
      const weekKey = getWeekKey();
      document.getElementById('weekVisits').textContent = data.weeklyVisits?.[weekKey] || 0;
      const monthKey = getMonthKey();
      document.getElementById('monthVisits').textContent = data.monthlyVisits?.[monthKey] || 0;
    }
  });
}

async function updateLiveCount() {
  const count = await countLiveVisitors();
  document.getElementById('liveVisitors').textContent = count;
  console.log(`👥 En ligne : ${count} visiteurs`);
}

async function initStats() {
  try {
    const docSnap = await getDoc(statsRef);
    if (!docSnap.exists()) {
      await setDoc(statsRef, {
        totalVisits: 0,
        totalDownloads: 0,
        dailyVisits: {},
        weeklyVisits: {},
        monthlyVisits: {}
      });
      console.log("📊 Document stats créé.");
    }
  } catch (error) {
    console.error("❌ Erreur création stats:", error);
  }
  await registerVisit();
  await registerPresence();
  await cleanOldSessions();
  displayStats();
  await updateLiveCount();
  setInterval(updateLiveCount, 5000);
  setInterval(updateHeartbeat, 30000);
  setInterval(cleanOldSessions, 10000);
  window.addEventListener('beforeunload', async () => {
    try {
      const sessionDoc = doc(presenceRef, sessionId);
      await deleteDoc(sessionDoc);
      console.log("🔴 Session supprimée à la fermeture");
    } catch (error) {
      console.error("❌ Erreur nettoyage départ:", error);
    }
  });
  const downloadBtn = document.getElementById('downloadBtn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await registerDownload();
      window.location.href = 'https://example.com/votre-app.apk';
    });
  }
}
// = FIN STATISTIQUES =

// ========== AUTHENTIFICATION UTILISATEUR (Google + Téléphone) ==========

// Sauvegarde automatique dans Firestore
async function saveUserToFirestore(user) {
  try {
    const userRef = doc(db, "users", user.uid);
    const data = {
      uid: user.uid,
      name: user.displayName || "",
      email: user.email || "",
      phoneNumber: user.phoneNumber || "",
      photoURL: user.photoURL || "",
      lastLogin: serverTimestamp()
    };
    await setDoc(userRef, data, { merge: true });
    console.log("✅ Utilisateur enregistré :", user.uid);
    return true;
  } catch (error) {
    console.error("❌ Erreur sauvegarde utilisateur :", error);
    return false;
  }
}

// Mise à jour de l'interface
function updateUserUI(user) {
  const profileDiv = document.getElementById("userProfile");
  const photo = document.getElementById("userPhoto");
  const nameSpan = document.getElementById("userName");
  const signInGoogle = document.getElementById("googleSignInBtn");
  const signInPhone = document.getElementById("phoneSignInBtn");
  const logoutBtn = document.getElementById("logoutBtnMenu");

  if (user) {
    profileDiv.style.display = "flex";
    photo.src = user.photoURL || "ssi.jpg";
    nameSpan.textContent = user.displayName || user.phoneNumber || "Utilisateur";
    signInGoogle.style.display = "none";
    signInPhone.style.display = "none";
    logoutBtn.style.display = "flex";
  } else {
    profileDiv.style.display = "none";
    signInGoogle.style.display = "flex";
    signInPhone.style.display = "flex";
    logoutBtn.style.display = "none";
  }
}

// Connexion Google
window.signInWithGoogle = async function() {
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    await saveUserToFirestore(user);
    firebaseUser = user;
    updateUserUI(user);
    showToast(`Connecté : ${user.displayName || user.email}`, "success");
  } catch (error) {
    console.error("Erreur Google :", error);
    showToast("Échec de la connexion Google", "error");
  }
};

// Déconnexion utilisateur (Google ou téléphone)
window.logoutUser = async function() {
  try {
    await signOut(auth);
    firebaseUser = null;
    updateUserUI(null);
    showToast("Déconnecté", "info");
  } catch (error) {
    console.error("Erreur déconnexion :", error);
    showToast("Erreur lors de la déconnexion", "error");
  }
};

// ========== AUTHENTIFICATION PAR TÉLÉPHONE ==========
let confirmationResult = null;
let recaptchaVerifier = null;
let phoneTimeout = null;

function getPhoneRecaptcha() {
  if (!recaptchaVerifier) {
    recaptchaVerifier = new RecaptchaVerifier(auth, 'sendCodeBtn', {
      size: 'invisible',
      callback: () => {}
    });
  }
  return recaptchaVerifier;
}

window.openPhoneAuthModal = function() {
  document.getElementById("phoneAuthModal").classList.add("active");
  document.getElementById("phoneAuthStep1").style.display = "block";
  document.getElementById("phoneAuthStep2").style.display = "none";
  document.getElementById("phoneError").style.display = "none";
  document.getElementById("otpError").style.display = "none";
  document.getElementById("phoneInput").value = "";
  document.getElementById("otpInput").value = "";
  if (phoneTimeout) {
    clearTimeout(phoneTimeout);
    phoneTimeout = null;
  }
  document.getElementById("resendBtn").style.display = "none";
  document.getElementById("resendTimer").textContent = "";
  // Réinitialiser le recaptcha
  if (recaptchaVerifier) {
    recaptchaVerifier.clear();
    recaptchaVerifier = null;
  }
};

window.closePhoneAuthModal = function() {
  document.getElementById("phoneAuthModal").classList.remove("active");
  if (phoneTimeout) {
    clearTimeout(phoneTimeout);
    phoneTimeout = null;
  }
  if (recaptchaVerifier) {
    recaptchaVerifier.clear();
    recaptchaVerifier = null;
  }
};

window.sendVerificationCode = async function() {
  const phoneInput = document.getElementById("phoneInput");
  const phoneNumber = phoneInput.value.trim();
  const errorDiv = document.getElementById("phoneError");

  // Validation basique
  if (!phoneNumber || phoneNumber.length < 8) {
    errorDiv.textContent = "Veuillez entrer un numéro valide (ex: +33712345678)";
    errorDiv.style.display = "block";
    return;
  }
  errorDiv.style.display = "none";

  try {
    const verifier = getPhoneRecaptcha();
    const appVerifier = verifier;
    const result = await signInWithPhoneNumber(auth, phoneNumber, appVerifier);
    confirmationResult = result;
    // Passer à l'étape 2
    document.getElementById("phoneAuthStep1").style.display = "none";
    document.getElementById("phoneAuthStep2").style.display = "block";
    document.getElementById("otpInput").value = "";
    document.getElementById("otpError").style.display = "none";

    // Démarrer un timer pour renvoyer le code
    let seconds = 60;
    const timerEl = document.getElementById("resendTimer");
    const resendBtn = document.getElementById("resendBtn");
    resendBtn.style.display = "none";
    timerEl.textContent = `Code envoyé. Prochain envoi dans ${seconds}s`;

    if (phoneTimeout) clearTimeout(phoneTimeout);
    phoneTimeout = setInterval(() => {
      seconds--;
      if (seconds <= 0) {
        clearInterval(phoneTimeout);
        phoneTimeout = null;
        timerEl.textContent = "";
        resendBtn.style.display = "inline";
      } else {
        timerEl.textContent = `Code envoyé. Prochain envoi dans ${seconds}s`;
      }
    }, 1000);

    showToast("Code SMS envoyé !", "success");
  } catch (error) {
    console.error("Erreur envoi SMS :", error);
    let message = "Erreur lors de l'envoi du code.";
    if (error.code === 'auth/invalid-phone-number') message = "Numéro de téléphone invalide.";
    else if (error.code === 'auth/too-many-requests') message = "Trop de tentatives. Réessayez plus tard.";
    else if (error.code === 'auth/quota-exceeded') message = "Quota de SMS dépassé.";
    errorDiv.textContent = message;
    errorDiv.style.display = "block";
    // Réinitialiser le recaptcha
    if (recaptchaVerifier) {
      recaptchaVerifier.clear();
      recaptchaVerifier = null;
    }
  }
};

window.resendCode = function() {
  document.getElementById("resendBtn").style.display = "none";
  // On repart à l'étape 1 pour renvoyer
  document.getElementById("phoneAuthStep1").style.display = "block";
  document.getElementById("phoneAuthStep2").style.display = "none";
  // On garde le numéro saisi
  sendVerificationCode();
};

window.verifyOtpCode = async function() {
  const otp = document.getElementById("otpInput").value.trim();
  const errorDiv = document.getElementById("otpError");

  if (!otp || otp.length < 6) {
    errorDiv.textContent = "Veuillez entrer les 6 chiffres reçus.";
    errorDiv.style.display = "block";
    return;
  }
  errorDiv.style.display = "none";

  try {
    const credential = PhoneAuthProvider.credential(confirmationResult.verificationId, otp);
    const result = await signInWithCredential(auth, credential);
    const user = result.user;
    await saveUserToFirestore(user);
    firebaseUser = user;
    updateUserUI(user);
    closePhoneAuthModal();
    showToast(`Connecté : ${user.phoneNumber}`, "success");
  } catch (error) {
    console.error("Erreur vérification OTP :", error);
    let message = "Code invalide ou expiré.";
    if (error.code === 'auth/invalid-verification-code') message = "Le code est incorrect.";
    else if (error.code === 'auth/code-expired') message = "Le code a expiré. Demandez un nouveau code.";
    else if (error.code === 'auth/too-many-requests') message = "Trop de tentatives. Réessayez plus tard.";
    errorDiv.textContent = message;
    errorDiv.style.display = "block";
  }
};

// ========== SUIVI DE L'ÉTAT D'AUTHENTIFICATION ==========
function initFirebaseAuth() {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      firebaseUser = user;
      await saveUserToFirestore(user);
      updateUserUI(user);
    } else {
      firebaseUser = null;
      updateUserUI(null);
    }
  });
}

// ========== PROFIL UTILISATEUR ==========
window.openUserProfileModal = function() {
  if (!firebaseUser) {
    showToast("Vous n'êtes pas connecté", "warning");
    return;
  }
  const user = firebaseUser;
  document.getElementById("profilePhoto").src = user.photoURL || "ssi.jpg";
  document.getElementById("profileName").textContent = user.displayName || "Non renseigné";
  document.getElementById("profileEmail").textContent = user.email || "Non renseigné";
  document.getElementById("profilePhone").textContent = user.phoneNumber || "Non renseigné";
  document.getElementById("profileUid").textContent = user.uid;
  document.getElementById("userProfileModal").classList.add("active");
};

window.closeUserProfileModal = function() {
  document.getElementById("userProfileModal").classList.remove("active");
};

// ******************** LE RESTE DU CODE (inchangé) ********************
function showToast(message, type = 'success', duration = 3500) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  const icons = { success: '✔', error: '✖', warning: '!', info: 'i' };
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || 'i'}</span> <span>${message}</span> <button class="toast-close" onclick="this.closest('.toast').remove()">✕</button>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
window.showToast = showToast;

function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const themes = ['light', 'dark', 'nature', 'vintage', 'modern', 'accessibility'];
  let newTheme = 'light';
  if (current === 'light') newTheme = 'dark';
  else newTheme = 'light';
  html.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
}
window.toggleTheme = toggleTheme;

function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
}
initTheme();

async function loadFamilyHistory() {
  try {
    const ref = doc(db, "config", "familyHistory");
    const docSnap = await getDoc(ref);
    if (docSnap.exists()) {
      familyHistory = docSnap.data().content || familyHistory;
    } else {
      await setDoc(ref, { content: familyHistory });
    }
    return familyHistory;
  } catch (error) {
    console.error("Erreur chargement histoire:", error);
    return familyHistory;
  }
}

async function saveFamilyHistory(content) {
  try {
    const ref = doc(db, "config", "familyHistory");
    await setDoc(ref, { content: content });
    familyHistory = content;
    return true;
  } catch (error) {
    console.error("Erreur sauvegarde histoire:", error);
    return false;
  }
}

async function loadJournal() {
  try {
    const q = query(collection(db, "journal"), orderBy("date", "desc"));
    const querySnapshot = await getDocs(q);
    journalEntries = [];
    querySnapshot.forEach((doc) => {
      journalEntries.push({ id: doc.id, ...doc.data() });
    });
    return journalEntries;
  } catch (error) {
    console.error("Erreur journal:", error);
    return [];
  }
}

async function addJournalEntry(action, type, data, userRole, targetData = null) {
  try {
    const entry = {
      action, type, data,
      user: userRole || "admin",
      date: new Date().toISOString(),
      status: "accepted",
      targetData: targetData || null
    };
    const docRef = await addDoc(collection(db, "journal"), entry);
    return docRef.id;
  } catch (error) {
    console.error("Erreur ajout journal:", error);
    return null;
  }
}

async function deleteJournalEntry(entryId) {
  try {
    await deleteDoc(doc(db, "journal", entryId));
    return true;
  } catch (error) {
    console.error("Erreur suppression journal:", error);
    return false;
  }
}

async function loadPasswords() {
  try {
    const docRef = doc(db, "config", "passwords");
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      if (data.admin) passwords.admin = data.admin;
      if (data.editor) passwords.editor = data.editor;
    } else {
      await setDoc(docRef, passwords);
    }
    return true;
  } catch (error) {
    console.error("Erreur chargement mots de passe:", error);
    return false;
  }
}

async function savePasswords() {
  try {
    const docRef = doc(db, "config", "passwords");
    await setDoc(docRef, passwords);
    return true;
  } catch (error) {
    console.error("Erreur sauvegarde mots de passe:", error);
    showToast("Erreur lors de la sauvegarde des mots de passe", "error");
    return false;
  }
}

window.authenticate = async function(e) {
  e.preventDefault();
  const password = document.getElementById("authPassword").value.trim();
  const errorEl = document.getElementById("authError");
  await loadPasswords();
  if (password === passwords.admin) {
    currentUser = { role: 'proprietaire' };
    errorEl.classList.remove("show");
    closeAuthModal();
    updateUIForAuth();
    showToast("Connecté en tant que Proprietaire", "success");
  } else if (password === passwords.editor) {
    currentUser = { role: 'admin' };
    errorEl.classList.remove("show");
    closeAuthModal();
    updateUIForAuth();
    showToast("Connecté en tant qu'Admin", "success");
  } else {
    errorEl.classList.add("show");
    setTimeout(() => errorEl.classList.remove("show"), 3000);
    showToast("Mot de passe incorrect", "error");
  }
};

window.openAuthModal = function() {
  document.getElementById("authModal").classList.add("active");
  document.getElementById("authPassword").value = "";
  document.getElementById("authError").classList.remove("show");
};

window.closeAuthModal = function() {
  document.getElementById("authModal").classList.remove("active");
};

window.logout = function() {
  currentUser = null;
  updateUIForAuth();
  if (currentNode) displayPerson(currentNode);
  showToast("Déconnecté (admin)", "info");
};

window.openAdminModal = function() {
  if (!currentUser || currentUser.role !== 'proprietaire') {
    showToast("Seul le proprietaire peut gérer les mots de passe", "error");
    return;
  }
  document.getElementById("adminModal").classList.add("active");
  document.getElementById("adminPassword").value = "";
  document.getElementById("editorPassword").value = "";
  document.getElementById("currentAdminPass").textContent = "••••••••";
  document.getElementById("currentEditorPass").textContent = "••••••••";
};

window.closeAdminModal = function() {
  document.getElementById("adminModal").classList.remove("active");
};

window.updatePasswords = async function(e) {
  e.preventDefault();
  if (!currentUser || currentUser.role !== 'proprietaire') {
    showToast("Seul le proprietaire peut modifier les mots de passe", "error");
    return;
  }
  const newAdminPass = document.getElementById("adminPassword").value.trim();
  const newEditorPass = document.getElementById("editorPassword").value.trim();
  if (newAdminPass && newAdminPass.length < 4) {
    showToast("Le mot de passe proprietaire doit faire au moins 4 caractères", "error");
    return;
  }
  if (newEditorPass && newEditorPass.length < 4) {
    showToast("Le mot de passe admin doit faire au moins 4 caractères", "error");
    return;
  }
  if (!newAdminPass && !newEditorPass) {
    showToast("Veuillez entrer au moins un nouveau mot de passe", "warning");
    return;
  }
  if (newAdminPass) passwords.admin = newAdminPass;
  if (newEditorPass) passwords.editor = newEditorPass;
  const saved = await savePasswords();
  if (saved) {
    closeAdminModal();
    showToast("Les mots de passe ont été mis à jour !", "success");
  }
};

window.openStatsModal = function() {
  if (!family) {
    showToast("Les données ne sont pas encore chargées", "warning");
    return;
  }
  document.getElementById("statsModal").classList.add("active");
  calculateStats();
};

window.closeStatsModal = function() {
  document.getElementById("statsModal").classList.remove("active");
};

function countNodes(node) {
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countNodes(child);
    }
  }
  return count;
}

function calculateStats() {
  const total = countNodes(family);
  document.getElementById('statTotal').textContent = total;
}

window.openHistoriqueModal = async function() {
  if (!currentUser || currentUser.role !== 'proprietaire') {
    showToast("Seul le proprietaire peut voir l'historique", "error");
    return;
  }
  document.getElementById("historiqueModal").classList.add("active");
  await renderHistorique();
};

window.closeHistoriqueModal = function() {
  document.getElementById("historiqueModal").classList.remove("active");
};

async function renderHistorique() {
  const container = document.getElementById("historiqueList");
  await loadJournal();
  if (journalEntries.length === 0) {
    container.innerHTML = `<div class="historique-empty"> <div class="icon">📭</div> <p>Aucune modification enregistrée.</p> </div>`;
    return;
  }
  let html = '';
  journalEntries.forEach(entry => {
    const typeLabel = { add: 'Ajout', edit: 'Modification', delete: 'Suppression' }[entry.type] || entry.type;
    const statusClass = entry.status || 'pending';
    const date = new Date(entry.date);
    const dateStr = date.toLocaleDateString('fr-FR') + ' ' + date.toLocaleTimeString('fr-FR', {hour: '2-digit', minute:'2-digit'});
    html += `
      <div class="historique-item ${entry.type}">
        <div class="info">
          <div class="action-type">
            <span class="type-${entry.type}">${typeLabel}</span>
            <span class="status-badge ${statusClass}">${entry.status || 'Accepté'}</span>
          </div>
          <div class="details">${entry.data}</div>
          <div class="date">${dateStr} · par ${entry.user || 'admin'}</div>
        </div>
        <div class="actions-historique">
          <button class="btn-delete-entry" onclick="deleteHistoriqueEntry('${entry.id}')">🗑</button>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

window.deleteHistoriqueEntry = async function(entryId) {
  if (!currentUser || currentUser.role !== 'proprietaire') {
    showToast("Seul le proprietaire peut supprimer des entrées", "error");
    return;
  }
  if (confirm("Êtes-vous sûr de vouloir supprimer cette entrée ?")) {
    const success = await deleteJournalEntry(entryId);
    if (success) {
      showToast("Entrée supprimée de l'historique", "success");
      await renderHistorique();
    } else {
      showToast("Erreur lors de la suppression", "error");
    }
  }
};

window.toggleMenu = function() {
  document.getElementById("hamburgerMenu").classList.toggle("open");
};

window.closeMenu = function() {
  document.getElementById("hamburgerMenu").classList.remove("open");
};

document.addEventListener('click', function(event) {
  const menu = document.getElementById("hamburgerMenu");
  const btn = document.querySelector(".hamburger-btn");
  if (menu.classList.contains("open") && !menu.contains(event.target) && !btn.contains(event.target)) {
    menu.classList.remove("open");
  }
});

function updateUIForAuth() {
  const isAuthenticated = currentUser !== null;
  const isProprietaire = isAuthenticated && currentUser.role === 'proprietaire';
  const isAdmin = isAuthenticated && (currentUser.role === 'proprietaire' || currentUser.role === 'admin');
  document.getElementById("addBtn").style.display = isAdmin ? "flex" : "none";
  document.getElementById("deleteBtn").style.display = isProprietaire ? "flex" : "none";
  document.getElementById("adminBtn").style.display = isProprietaire ? "flex" : "none";
  document.getElementById("historiqueBtn").style.display = isProprietaire ? "flex" : "none";
  document.getElementById("exportBtn").style.display = isProprietaire ? "flex" : "none";
  document.getElementById("importBtn").style.display = isProprietaire ? "flex" : "none";
  document.getElementById("statsBtn").style.display = "flex";
  document.getElementById("loginBtn").style.display = isAuthenticated ? "none" : "flex";
  document.getElementById("logoutBtn").style.display = isAuthenticated ? "flex" : "none";
  const historyEditBtn = document.getElementById("historyEditBtn");
  if (historyEditBtn) {
    historyEditBtn.style.display = isProprietaire ? "flex" : "none";
  }
  const statusEl = document.getElementById("authStatus");
  const menuStatusEl = document.getElementById("menuAuthStatus");
  if (isAuthenticated) {
    const statusText = isProprietaire ? "Proprietaire" : "Admin";
    const statusClass = isProprietaire ? "proprietaire" : "admin";
    statusEl.textContent = statusText;
    statusEl.className = `auth-status show ${statusClass}`;
    menuStatusEl.textContent = statusText;
    menuStatusEl.className = `auth-status show ${statusClass}`;
    menuStatusEl.style.display = "block";
  } else {
    statusEl.textContent = "";
    statusEl.className = "auth-status";
    statusEl.style.display = "none";
    menuStatusEl.textContent = "Non connecté";
    menuStatusEl.className = "auth-status show";
    menuStatusEl.style.display = "block";
    menuStatusEl.style.textAlign = "center";
    menuStatusEl.style.padding = "6px 10px";
    menuStatusEl.style.marginBottom = "4px";
    menuStatusEl.style.background = "rgba(0,0,0,0.03)";
    menuStatusEl.style.borderRadius = "10px";
    menuStatusEl.style.border = "1px solid rgba(0,0,0,0.04)";
    menuStatusEl.style.fontWeight = "500";
    menuStatusEl.style.letterSpacing = "0.2px";
    menuStatusEl.style.color = "#1a1a1a";
  }
}

const treeEl = document.getElementById('tree');
const backBtn = document.getElementById('backBtn');
const breadcrumbEl = document.getElementById('breadcrumb');
const mainHeader = document.getElementById('mainHeader');

async function chargerfamille() {
  try {
    const ref = doc(db, "famille", "bollou_oumar");
    const resultat = await getDoc(ref);
    if (resultat.exists()) {
      family = resultat.data();
      if (!family.gender) family.gender = 'unknown';
      if (!family.gender || family.gender === '') family.gender = 'male';
      currentPath = [family];
      displayRoot();
    } else {
      treeEl.innerHTML = "<p>Aucune donnée trouvée.</p>";
    }
  } catch (error) {
    console.error("Erreur de chargement :", error);
    treeEl.innerHTML = "<p>Erreur lors du chargement des données.</p>";
  }
}

async function sauvegarderFamille() {
  try {
    const ref = doc(db, "famille", "bollou_oumar");
    await updateDoc(ref, {
      name: family.name,
      children: family.children || [],
      photo: family.photo || "",
      gender: family.gender || "male",
      birth: family.birth || "",
      bio: family.bio || ""
    });
    return true;
  } catch (error) {
    console.error("Erreur sauvegarde:", error);
    showToast("Erreur lors de la sauvegarde", "error");
    return false;
  }
}

function findNodeWithParent(node, targetName, parent = null) {
  if (node.name === targetName) return { node, parent };
  if (!node.children) return null;
  for (let child of node.children) {
    const result = findNodeWithParent(child, targetName, node);
    if (result) return result;
  }
  return null;
}

function findPathToNode(node, targetName, path = []) {
  if (node.name === targetName) return [...path, node];
  if (!node.children) return null;
  for (let child of node.children) {
    const result = findPathToNode(child, targetName, [...path, node]);
    if (result) return result;
  }
  return null;
}

function getAllNames(node, path = '') {
  const results = [{ name: node.name, path: path || node.name }];
  if (node.children) {
    for (const child of node.children) {
      results.push(...getAllNames(child, path ? `${path} → ${child.name}` : child.name));
    }
  }
  return results;
}

function getPathToNode(node, targetName, path = []) {
  if (node.name === targetName) return [...path, node];
  if (!node.children) return null;
  for (let child of node.children) {
    const result = getPathToNode(child, targetName, [...path, node]);
    if (result) return result;
  }
  return null;
}

function findNodeByName(node, targetName) {
  if (node.name === targetName) return node;
  if (!node.children) return null;
  for (const child of node.children) {
    const result = findNodeByName(child, targetName);
    if (result) return result;
  }
  return null;
}

window.exportFamily = function() {
  if (!currentUser || currentUser.role !== 'proprietaire') {
    showToast("Seul le proprietaire peut exporter", "error");
    return;
  }
  if (!family) {
    showToast("Aucune donnée à exporter", "warning");
    return;
  }
  const data = JSON.stringify(family, null, 2);
  const blob = new Blob([data], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `arbre_gaway_${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("Arbre exporté avec succès !", "success");
};

window.importFamily = function(event) {
  if (!currentUser || currentUser.role !== 'proprietaire') {
    showToast("Seul le proprietaire peut importer", "error");
    return;
  }
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.name || !data.children) {
        showToast("Fichier invalide", "error");
        return;
      }
      const count = countNodes(data);
      if (confirm(`Voulez-vous importer "${data.name}" (${count} personnes) ?\nCela remplacera l'arbre actuel.`)) {
        family = data;
        await sauvegarderFamille();
        buildNameIndex();
        currentPath = [family];
        currentNode = family;
        displayRoot();
        showToast(`Arbre importé avec succès (${count} personnes) !`, "success");
      }
    } catch (error) {
      showToast("Fichier JSON invalide", "error");
    }
  };
  reader.readAsText(file);
  event.target.value = '';
};

window.shareFamily = function() {
  const url = window.location.href;
  if (navigator.share) {
    navigator.share({
      title: 'Arbre généalogique Gaway',
      text: 'Découvrez l\'arbre généalogique de Gaïda',
      url: url
    }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url).then(() => {
      showToast("Lien copié dans le presse-papier !", "success");
    }).catch(() => {
      showToast("URL : " + url, "info", 5000);
    });
  }
};

let searchTimeout = null;
let allNames = [];

function buildNameIndex() {
  if (family) allNames = getAllNames(family);
}

window.handleSearchInput = function(value) {
  const suggestions = document.getElementById("searchSuggestions");
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    suggestions.classList.remove("active");
    if (currentNode) displayPerson(currentNode);
    else displayRoot();
    return;
  }
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    const results = allNames.filter(item => item.name.toLowerCase().includes(trimmed)).slice(0, 8);
    if (results.length === 0) {
      suggestions.classList.remove("active");
      return;
    }
    suggestions.innerHTML = '';
    results.forEach(item => {
      const div = document.createElement("div");
      div.className = "search-suggestion";
      const idx = item.name.toLowerCase().indexOf(trimmed);
      let displayName = item.name;
      if (idx !== -1) {
        displayName = item.name.slice(0, idx) +
          `<span class="highlight">${item.name.slice(idx, idx + trimmed.length)}</span>` +
          item.name.slice(idx + trimmed.length);
      }
      div.innerHTML = `
        <span>${displayName}</span>
        <span class="suggestion-path">${item.path}</span>
      `;
      div.onclick = () => {
        suggestions.classList.remove("active");
        const result = findPathToNode(family, item.name);
        if (result) {
          history = result.slice(0, -1);
          currentPath = result;
          currentNode = result[result.length - 1];
          displayPerson(currentNode);
          document.getElementById("searchBox").value = item.name;
        }
      };
      suggestions.appendChild(div);
    });
    suggestions.classList.add("active");
  }, 200);
};

document.addEventListener('click', function(e) {
  const suggestions = document.getElementById("searchSuggestions");
  const searchBox = document.getElementById("searchBox");
  if (!suggestions.contains(e.target) && e.target !== searchBox) {
    suggestions.classList.remove("active");
  }
});

document.addEventListener('keydown', function(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    document.getElementById("searchBox").focus();
  }
  if (e.key === 'Escape') {
    document.getElementById("searchSuggestions").classList.remove("active");
    document.getElementById("searchBox").blur();
  }
});

function displayPerson(person) {
  treeEl.innerHTML = "";
  currentNode = person;
  backBtn.style.display = "inline-block";
  updateBreadcrumb();
  const isAuthenticated = currentUser !== null;
  const isProprietaire = isAuthenticated && currentUser.role === 'proprietaire';
  const isAdmin = isAuthenticated && (currentUser.role === 'proprietaire' || currentUser.role === 'admin');
  document.getElementById("addBtn").style.display = isAdmin ? "flex" : "none";
  document.getElementById("deleteBtn").style.display = isProprietaire ? "flex" : "none";
  document.getElementById("adminBtn").style.display = isProprietaire ? "flex" : "none";
  document.getElementById("historiqueBtn").style.display = isProprietaire ? "flex" : "none";
  document.getElementById("exportBtn").style.display = isProprietaire ? "flex" : "none";
  document.getElementById("importBtn").style.display = isProprietaire ? "flex" : "none";
  document.getElementById("statsBtn").style.display = "flex";

  if (!person.children || person.children.length === 0) {
    treeEl.innerHTML = "<p>La liste des enfants n'est pas encore complète.</p>";
    return;
  }

  const searchQuery = document.getElementById("searchBox").value.toLowerCase();
  let childrenToShow = person.children;
  if (searchQuery) {
    childrenToShow = person.children.filter(child => child.name.toLowerCase().includes(searchQuery));
  }

  childrenToShow.forEach((child, index) => {
    const div = document.createElement("div");
    div.className = "person";
    div.draggable = true;
    div.dataset.index = index;

    div.onclick = (e) => {
      if (e.target.closest('.detail-btn')) return;
      if (e.target.tagName === 'INPUT') return;
      history.push(person);
      currentPath.push(child);
      displayPerson(child);
    };

    let dragIndex = null;
    div.addEventListener('dragstart', (e) => {
      if (!currentUser || (currentUser.role !== 'proprietaire' && currentUser.role !== 'admin')) {
        e.preventDefault();
        showToast("Permission refusée", "error");
        return;
      }
      dragIndex = index;
      e.dataTransfer.effectAllowed = 'move';
      div.classList.add('dragging');
    });

    div.addEventListener('dragend', () => {
      div.classList.remove('dragging');
    });

    div.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      div.style.transform = 'scale(1.05)';
    });

    div.addEventListener('dragleave', () => {
      div.style.transform = '';
    });

    div.addEventListener('drop', async (e) => {
      e.preventDefault();
      div.style.transform = '';
      if (dragIndex === null || dragIndex === index) return;
      if (!currentUser || (currentUser.role !== 'proprietaire' && currentUser.role !== 'admin')) {
        showToast("Permission refusée", "error");
        return;
      }
      const [moved] = person.children.splice(dragIndex, 1);
      person.children.splice(index, 0, moved);
      await sauvegarderFamille();
      displayPerson(person);
      showToast("Ordre modifié !", "success");
      dragIndex = null;
    });

    const img = document.createElement("img");
    img.src = child.photo ? "photos/" + child.photo : "ssi.jpg";
    img.alt = child.name;
    img.onerror = () => { img.src = "ssi.jpg"; };

    const name = document.createElement("div");
    name.className = "person-name";
    name.textContent = child.name;

    div.appendChild(img);
    div.appendChild(name);

    const detailBtn = document.createElement("button");
    detailBtn.className = "detail-btn";
    detailBtn.innerHTML = "👤";
    detailBtn.title = "carte de " + child.name;
    detailBtn.onclick = (e) => {
      e.stopPropagation();
      openPersonDetail(child);
    };
    div.appendChild(detailBtn);

    treeEl.appendChild(div);
  });
}

function displayRoot() {
  treeEl.innerHTML = "";
  history = [];
  currentPath = [family];
  currentNode = family;
  backBtn.style.display = "none";
  mainHeader.style.display = "block";
  breadcrumbEl.style.display = "none";
  mainHeader.textContent = "Le passé éclaire ton présent";

  const isAuthenticated = currentUser !== null;
  const isProprietaire = isAuthenticated && currentUser.role === 'proprietaire';
  const isAdmin = isAuthenticated && (currentUser.role === 'proprietaire' || currentUser.role === 'admin');
  document.getElementById("deleteBtn").style.display = isProprietaire ? "flex" : "none";
  document.getElementById("addBtn").style.display = isAdmin ? "flex" : "none";
  document.getElementById("adminBtn").style.display = isProprietaire ? "flex" : "none";
  document.getElementById("historiqueBtn").style.display = isProprietaire ? "flex" : "none";
  document.getElementById("exportBtn").style.display = isProprietaire ? "flex" : "none";
  document.getElementById("importBtn").style.display = isProprietaire ? "flex" : "none";
  document.getElementById("statsBtn").style.display = "flex";

  if (!family) return;

  const div = document.createElement("div");
  div.className = "person";

  div.onclick = (e) => {
    if (e.target.closest('.detail-btn')) return;
    history.push(family);
    displayPerson(family);
  };

  const img = document.createElement("img");
  img.src = family.photo ? "photos/" + family.photo : "ssi.jpg";
  img.alt = family.name;
  img.onerror = () => { img.src = "ssi.jpg"; };

  const name = document.createElement("div");
  name.className = "person-name";
  name.textContent = family.name;

  div.appendChild(img);
  div.appendChild(name);

  const detailBtn = document.createElement("button");
  detailBtn.className = "detail-btn";
  detailBtn.innerHTML = "👤";
  detailBtn.title = "Voir les détails de " + family.name;
  detailBtn.onclick = (e) => {
    e.stopPropagation();
    openPersonDetail(family);
  };
  div.appendChild(detailBtn);

  treeEl.appendChild(div);
}

window.goBack = function() {
  if (history.length) {
    const prev = history.pop();
    currentPath.pop();
    displayPerson(prev);
  } else {
    displayRoot();
  }
};

function updateBreadcrumb() {
  if (currentPath.length <= 1) {
    breadcrumbEl.style.display = "none";
    mainHeader.style.display = "block";
  } else {
    mainHeader.style.display = "none";
    breadcrumbEl.style.display = "block";
    breadcrumbEl.innerHTML = "";
    currentPath.forEach((p, i) => {
      if (i > 0) {
        breadcrumbEl.innerHTML += " → ";
        const span = document.createElement("span");
        span.textContent = p.name;
        span.onclick = () => {
          const newPath = currentPath.slice(0, i + 1);
          history = newPath.slice(0, -1);
          currentPath = newPath;
          displayPerson(p);
        };
        breadcrumbEl.appendChild(span);
      }
    });
  }
}

let currentDetailPerson = null;

window.openPersonDetail = function(person) {
  currentDetailPerson = person;
  lastDetailPerson = person;

  const gender = person.gender || 'unknown';
  const genderText = gender === 'male' ? 'Homme' : gender === 'female' ? 'Femme' : 'Non renseigné';
  const genderClass = gender === 'male' ? 'male' : gender === 'female' ? 'female' : 'unknown';

  const cover = document.getElementById("detailCover");
  cover.className = `detail-cover ${genderClass}`;

  document.getElementById("detailAvatar").src = person.photo ? "photos/" + person.photo : "ssi.jpg";
  document.getElementById("detailAvatar").onerror = function() { this.src = "ssi.jpg"; };

  if (person === family) {
    document.getElementById('detailPath').innerHTML = `<span class="path-root">Racine</span> <span class="path-arrow">→</span> <span class="path-name" style="color: var(--accent); font-weight: 600;">${person.name}</span>`;
  } else {
    const path = getPathToNode(family, person.name);
    if (path && path.length > 1) {
      let pathHtml = `<span class="path-root">${family.name}</span>`;
      for (let i = 1; i < path.length - 1; i++) {
        pathHtml += ` <span class="path-arrow">→</span> <span class="path-name">${path[i].name}</span>`;
      }
      pathHtml += ` <span class="path-arrow">→</span> <span class="path-name" style="color: var(--accent); font-weight: 600;">${person.name}</span>`;
      document.getElementById('detailPath').innerHTML = pathHtml;
    } else {
      document.getElementById('detailPath').innerHTML = `<span class="path-root">${family.name}</span> <span class="path-arrow">→</span> <span class="path-name" style="color: var(--accent); font-weight: 600;">${person.name}</span>`;
    }
  }

  renderDetailFields(person);
  document.getElementById("personDetailModal").classList.add("active");
};

function renderDetailFields(person) {
  const isProprietaire = currentUser && currentUser.role === 'proprietaire';
  const canEdit = isProprietaire && person !== family;

  const nameWrapper = document.getElementById('detailNameWrapper');
  const nameDisplay = document.getElementById('detailName');

  if (canEdit) {
    nameWrapper.innerHTML = `<input type="text" class="detail-name-input" id="nameInput" value="${person.name || ''}"  onchange="saveDetailField('name', this.value)" onclick="event.stopPropagation();" placeholder="Nom">`;
  } else {
    nameWrapper.innerHTML = `<div class="detail-name" id="detailName">${person.name || 'Nom inconnu'}</div>`;
  }

  const genderCard = document.getElementById('detailGenderCard');
  const genderValue = document.getElementById('detailGender');
  const genderText = person.gender === 'male' ? 'Homme' : person.gender === 'female' ? 'Femme' : 'Non renseigné';

  if (canEdit) {
    genderCard.classList.add('editable');
    genderValue.innerHTML = `<select class="detail-value-select" id="genderSelect" onchange="saveDetailField('gender', this.value)"> <option value="male" ${person.gender === 'male' ? 'selected' : ''}>Homme</option> <option value="female" ${person.gender === 'female' ? 'selected' : ''}>Femme</option> <option value="unknown" ${person.gender === 'unknown' || !person.gender ? 'selected' : ''}>Non renseigné</option> </select>`;
  } else {
    genderCard.classList.remove('editable');
    genderValue.textContent = genderText;
    genderValue.className = `detail-value${genderText === 'Non renseigné' ? ' empty' : ''}`;
  }

  const birthCard = document.getElementById('detailBirthCard');
  const birthValue = document.getElementById('detailBirth');
  const birthText = person.birth || "Non renseigné";

  if (canEdit) {
    birthCard.classList.add('editable');
    birthValue.innerHTML = `<input type="date" class="detail-value-input" id="birthInput" value="${person.birth || ''}"  onchange="saveDetailField('birth', this.value)"  onclick="event.stopPropagation();">`;
  } else {
    birthCard.classList.remove('editable');
    birthValue.textContent = birthText;
    birthValue.className = `detail-value${birthText === "Non renseigné" ? ' empty' : ''}`;
  }

  const bioCard = document.getElementById('detailBioCard');
  const bioValue = document.getElementById('detailBio');
  const bioText = person.bio || "Non renseignée";

  if (canEdit) {
    bioCard.classList.add('editable');
    bioValue.innerHTML = `<textarea class="detail-value-textarea" id="bioInput" rows="2"  placeholder="Courte biographie..."  onchange="saveDetailField('bio', this.value)"  onclick="event.stopPropagation();" style="resize: vertical; min-height: 50px;">${person.bio || ''}</textarea>`;
  } else {
    bioCard.classList.remove('editable');
    bioValue.textContent = bioText;
    bioValue.className = `detail-value${bioText === "Non renseignée" ? ' empty' : ''}`;
  }

  const childrenCount = (person.children && person.children.length) || 0;
  document.getElementById("detailChildren").textContent = childrenCount;

  const roleBadge = document.getElementById("detailRole");
  const roleText = person === family ? "Racine" : "Membre";
  const genderClass = person.gender === 'male' ? 'male' : person.gender === 'female' ? 'female' : 'unknown';
  roleBadge.textContent = roleText;
  roleBadge.className = `role-badge ${genderClass}`;
}

window.saveDetailField = async function(field, value) {
  if (!currentDetailPerson) return;
  if (!currentUser || currentUser.role !== 'proprietaire') {
    showToast("Seul le proprietaire peut modifier", "error");
    return;
  }
  if (currentDetailPerson === family) {
    showToast("La racine ne peut pas être modifiée ici", "warning");
    return;
  }

  const oldValue = currentDetailPerson[field] || '';
  const newValue = value || '';

  if (newValue === oldValue) return;

  const fieldNames = {
    name: 'Nom',
    gender: 'Genre',
    birth: 'Date de naissance',
    bio: 'Biographie'
  };

  if (field === 'name') {
    const trimmedName = newValue.trim();
    if (!trimmedName) {
      showToast("Le nom ne peut pas être vide", "warning");
      renderDetailFields(currentDetailPerson);
      return;
    }
    const existing = findNodeByName(family, trimmedName);
    if (existing && existing !== currentDetailPerson) {
      showToast(`"${trimmedName}" existe déjà`, "warning");
      renderDetailFields(currentDetailPerson);
      return;
    }
    currentDetailPerson.name = trimmedName;
    if (currentNode === currentDetailPerson) {
      currentNode.name = trimmedName;
    }
    buildNameIndex();
    if (currentNode === currentDetailPerson) {
      displayPerson(currentNode);
    }
  } else {
    currentDetailPerson[field] = newValue;
  }

  const saved = await sauvegarderFamille();
  if (saved) {
    renderDetailFields(currentDetailPerson);
    await addJournalEntry('edit', 'edit',
      `${fieldNames[field] || field} modifié: "${oldValue || 'vide'}" → "${newValue || 'vide'}"`,
      'proprietaire'
    );
    showToast(`${fieldNames[field] || field} modifié avec succès !`, "success");
  }
};

window.closePersonDetailModal = function() {
  document.getElementById("personDetailModal").classList.remove("active");
  currentDetailPerson = null;
};

window.openAddModal = function() {
  if (!currentUser || (currentUser.role !== 'proprietaire' && currentUser.role !== 'admin')) {
    showToast("Seul le proprietaire ou admin peut ajouter", "error");
    return;
  }
  document.getElementById("addModal").classList.add("active");
  document.getElementById("addName").value = "";
  document.getElementById("addGender").value = "";
  document.getElementById("addBirth").value = "";
  document.getElementById("addBio").value = "";
};

window.closeAddModal = function() {
  document.getElementById("addModal").classList.remove("active");
};

window.addPerson = async function(e) {
  e.preventDefault();
  if (!currentUser || (currentUser.role !== 'proprietaire' && currentUser.role !== 'admin')) {
    showToast("Seul le proprietaire ou admin peut ajouter", "error");
    return;
  }

  const name = document.getElementById("addName").value.trim();
  const gender = document.getElementById("addGender").value;
  const birth = document.getElementById("addBirth").value;
  const bio = document.getElementById("addBio").value.trim();

  if (!name) {
    showToast("Veuillez entrer un nom", "warning");
    return;
  }
  if (!gender) {
    showToast("Veuillez sélectionner un genre", "warning");
    return;
  }

  if (!currentNode) {
    showToast("Aucun noeud sélectionné", "error");
    return;
  }

  if (currentNode.children && currentNode.children.some(c => c.name === name)) {
    showToast(`"${name}" existe déjà`, "warning");
    return;
  }

  const newPerson = {
    name,
    gender: gender,
    photo: "",
    birth: birth || "",
    bio: bio || "",
    children: []
  };
  if (!currentNode.children) currentNode.children = [];
  currentNode.children.push(newPerson);

  const saved = await sauvegarderFamille();
  if (saved) {
    closeAddModal();
    buildNameIndex();
    if (currentNode === family) displayRoot();
    else displayPerson(currentNode);

    const userRole = currentUser.role === 'proprietaire' ? 'proprietaire' : 'admin';
    await addJournalEntry('add', 'add', `${name} (${gender}) ajouté par ${userRole}`, userRole);
    showToast(`"${name}" a été ajouté !`, "success");
  }
};

window.openEditModal = function() {
  showToast("La modification se fait dans la vue détail", "info");
};

window.closeEditModal = function() {
  document.getElementById("editModal").classList.remove("active");
};

window.editPerson = async function(e) {
  e.preventDefault();
  showToast("Utilisez la vue détail pour modifier", "info");
};

let deletingPerson = null;
let deletingParent = null;

window.openDeleteModal = function() {
  if (!currentUser || currentUser.role !== 'proprietaire') {
    showToast("Seul le proprietaire peut supprimer", "error");
    return;
  }

  if (currentNode === family) {
    showToast("Impossible de supprimer la racine de l'arbre", "warning");
    return;
  }

  if (!currentNode) {
    showToast("Sélectionnez une personne à supprimer", "warning");
    return;
  }

  const result = findNodeWithParent(family, currentNode.name);
  if (result) {
    deletingPerson = result.node;
    deletingParent = result.parent;
    document.getElementById("deleteName").textContent = deletingPerson.name;
    document.getElementById("deleteModal").classList.add("active");
  } else {
    showToast("Erreur : personne non trouvée", "error");
  }
};

window.closeDeleteModal = function() {
  document.getElementById("deleteModal").classList.remove("active");
  deletingPerson = null;
  deletingParent = null;
};

window.confirmDelete = async function() {
  if (!currentUser || currentUser.role !== 'proprietaire') {
    showToast("Seul le proprietaire peut supprimer", "error");
    return;
  }
  if (!deletingPerson || !deletingParent) {
    showToast("Erreur : aucune personne à supprimer", "error");
    return;
  }

  const nameToDelete = deletingPerson.name;
  deletingParent.children = deletingParent.children.filter(child => child !== deletingPerson);

  const saved = await sauvegarderFamille();
  if (saved) {
    closeDeleteModal();
    buildNameIndex();
    currentPath = [family];
    const newPath = findPathToNode(family, deletingParent.name);
    if (newPath) {
      currentPath = newPath;
      displayPerson(deletingParent);
    } else {
      displayRoot();
    }
    await addJournalEntry('delete', 'delete', `${nameToDelete} supprimé par proprietaire`, 'proprietaire');
    showToast(`"${nameToDelete}" a été supprimé`, "success");
  }
};

let isHistoryEditMode = false;

window.openHistoryModal = async function() {
  await loadFamilyHistory();
  document.getElementById("historyModal").classList.add("active");

  const displayEl = document.getElementById("historyTextDisplay");
  const textarea = document.getElementById("historyTextarea");

  displayEl.innerHTML = familyHistory.replace(/\n/g, '<br>');
  textarea.value = familyHistory;

  const isProprietaire = currentUser && currentUser.role === 'proprietaire';
  document.getElementById("historyEditBtn").style.display = isProprietaire ? "flex" : "none";

  if (isHistoryEditMode) {
    cancelHistoryEdit();
  }
};

window.closeHistoryModal = function() {
  document.getElementById("historyModal").classList.remove("active");
  if (isHistoryEditMode) cancelHistoryEdit();
};

window.enableHistoryEdit = function() {
  if (!currentUser || currentUser.role !== 'proprietaire') {
    showToast("Seul le proprietaire peut modifier les informations", "error");
    return;
  }

  isHistoryEditMode = true;
  document.getElementById("historyDisplay").style.display = "none";
  document.getElementById("historyEdit").style.display = "block";
  document.getElementById("historyEditBtn").style.display = "none";

  const textarea = document.getElementById("historyTextarea");
  textarea.value = familyHistory;
  textarea.focus();
};

window.cancelHistoryEdit = function() {
  isHistoryEditMode = false;
  document.getElementById("historyDisplay").style.display = "block";
  document.getElementById("historyEdit").style.display = "none";

  const isProprietaire = currentUser && currentUser.role === 'proprietaire';
  document.getElementById("historyEditBtn").style.display = isProprietaire ? "flex" : "none";
};

window.saveHistory = async function() {
  if (!currentUser || currentUser.role !== 'proprietaire') {
    showToast("Seul le proprietaire peut modifier les informations", "error");
    return;
  }

  const newContent = document.getElementById("historyTextarea").value;
  const oldContent = familyHistory;

  if (newContent === oldContent) {
    showToast("Aucune modification détectée", "info");
    cancelHistoryEdit();
    return;
  }

  const saved = await saveFamilyHistory(newContent);
  if (saved) {
    document.getElementById("historyTextDisplay").innerHTML = newContent.replace(/\n/g, '<br>');
    await addJournalEntry('edit', 'edit', 'Informations de la famille modifiées', 'proprietaire');
    showToast("Informations mises à jour avec succès !", "success");
    cancelHistoryEdit();
  } else {
    showToast("Erreur lors de la sauvegarde", "error");
  }
};

const CACHE_KEY = 'gaway_family_cache';

function saveToCache(data) {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ family: data, timestamp: Date.now() }));
}

const originalSave = sauvegarderFamille;
sauvegarderFamille = async function() {
  const result = await originalSave();
  if (result) saveToCache(family);
  return result;
};

async function init() {
  await loadPasswords();
  await chargerfamille();
  await loadJournal();
  await loadFamilyHistory();
  buildNameIndex();
  updateUIForAuth();
  await initStats();
  initFirebaseAuth(); // Initialisation de l'écoute d'authentification Firebase
}

init();

window.findNodeWithParent = findNodeWithParent;
window.findPathToNode = findPathToNode;
window.buildNameIndex = buildNameIndex;
window.countNodes = countNodes;
window.sauvegarderFamille = sauvegarderFamille;