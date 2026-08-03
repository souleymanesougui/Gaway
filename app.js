// app.js
import { 
  db,
  incrementVisits, 
  incrementDownloads, 
  getStats, 
  updateUserActivity,
  loadFamilyData,
  saveFamilyData,
  loadPasswords as loadPasswordsDB,
  savePasswords as savePasswordsDB,
  loadFamilyHistory as loadFamilyHistoryDB,
  saveFamilyHistory as saveFamilyHistoryDB,
  addJournalEntry,
  loadJournal,
  deleteJournalEntry,
  listenToStats
} from './firebase.js';

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
  onSnapshot
} from "firebase/firestore";

// ============================================
// ÉTAT GLOBAL
// ============================================

let currentUser = null;
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

// ============================================
// TOAST NOTIFICATIONS
// ============================================

function showToast(message, type = 'success', duration = 3500) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  const icons = { success: '✔', error: '✖', warning: '!', info: 'i' };
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'i'}</span>
    <span>${message}</span>
    <button class="toast-close" onclick="this.closest('.toast').remove()">✕</button>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
window.showToast = showToast;

// ============================================
// THÈME
// ============================================

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

// ============================================
// FONCTIONS D'AUTHENTIFICATION
// ============================================

window.authenticate = async function(e) {
  e.preventDefault();
  const password = document.getElementById("authPassword").value.trim();
  const errorEl = document.getElementById("authError");
  
  const loaded = await loadPasswords();
  if (!loaded) {
    showToast("Erreur de chargement des mots de passe", "error");
    return;
  }
  
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
  showToast("Déconnecté", "info");
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

  const saved = await savePasswordsDB(passwords);
  if (saved) {
    closeAdminModal();
    showToast("Les mots de passe ont été mis à jour !", "success");
  }
};

// ============================================
// FONCTIONS D'HISTORIQUE
// ============================================

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
  journalEntries = await loadJournal();
  
  if (journalEntries.length === 0) {
    container.innerHTML = `
      <div class="historique-empty">
        <div class="icon">📭</div>
        <p>Aucune modification enregistrée.</p>
      </div>
    `;
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

// ============================================
// FONCTIONS DE STATISTIQUES
// ============================================

let statsUpdateInterval = null;

async function initStats() {
  // Incrémenter les visites
  await incrementVisits();
  
  // Générer ou récupérer l'ID utilisateur
  let userId = sessionStorage.getItem('userId');
  if (!userId) {
    userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    sessionStorage.setItem('userId', userId);
  }
  updateUserActivity(userId);
  
  // Écouter les changements en temps réel
  listenToStats(() => {
    updateStatsUI();
  });
  
  // Mettre à jour l'activité toutes les 30 secondes
  setInterval(() => {
    const uid = sessionStorage.getItem('userId');
    if (uid) {
      updateUserActivity(uid);
    }
  }, 30000);
  
  // Mettre à jour les stats toutes les 30 secondes
  statsUpdateInterval = setInterval(() => {
    updateStatsUI();
  }, 30000);
}

window.openStatsModal = async function() {
  if (!family) {
    showToast("Les données ne sont pas encore chargées", "warning");
    return;
  }
  document.getElementById("statsModal").classList.add("active");
  await updateStatsUI();
};

window.closeStatsModal = function() {
  document.getElementById("statsModal").classList.remove("active");
};

async function updateStatsUI() {
  const stats = await getStats();
  if (!stats) {
    showToast("Erreur lors du chargement des statistiques", "error");
    return;
  }
  
  const totalPersons = countNodes(family);
  
  document.getElementById('statTotalPersons').textContent = totalPersons;
  document.getElementById('statTotalVisits').textContent = stats.totalVisits || 0;
  document.getElementById('statTotalDownloads').textContent = stats.totalDownloads || 0;
  document.getElementById('statOnlineUsers').textContent = stats.onlineUsers || 0;
  document.getElementById('statTodayVisits').textContent = stats.todayVisits || 0;
  document.getElementById('statWeekVisits').textContent = stats.weekVisits || 0;
  document.getElementById('statMonthVisits').textContent = stats.monthVisits || 0;
  
  // Mettre à jour la section en direct
  document.getElementById('liveVisits').textContent = stats.onlineUsers || 0;
}

window.trackDownload = async function() {
  await incrementDownloads();
  showToast("Téléchargement enregistré !", "success");
  await updateStatsUI();
};

// ============================================
// MENU
// ============================================

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

// ============================================
// UI AUTH
// ============================================

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

// ============================================
// ARBRE GÉNÉALOGIQUE
// ============================================

const treeEl = document.getElementById('tree');
const backBtn = document.getElementById('backBtn');
const breadcrumbEl = document.getElementById('breadcrumb');
const mainHeader = document.getElementById('mainHeader');

function countNodes(node) {
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countNodes(child);
    }
  }
  return count;
}

async function chargerfamille() {
  try {
    const data = await loadFamilyData();
    if (data) {
      family = data;
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
  return await saveFamilyData(family);
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

// ============================================
// EXPORT / IMPORT
// ============================================

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

// ============================================
// RECHERCHE
// ============================================

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

// ============================================
// AFFICHAGE
// ============================================

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
  mainHeader.textContent = "Trouvez vos grands parents";
  
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

// ============================================
// DÉTAIL PERSONNE
// ============================================

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
    document.getElementById('detailPath').innerHTML = `
      <span class="path-root">Racine</span>
      <span class="path-arrow">→</span>
      <span class="path-name" style="color: var(--accent); font-weight: 600;">${person.name}</span>
    `;
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
      document.getElementById('detailPath').innerHTML = `
        <span class="path-root">${family.name}</span>
        <span class="path-arrow">→</span>
        <span class="path-name" style="color: var(--accent); font-weight: 600;">${person.name}</span>
      `;
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
    nameWrapper.innerHTML = `
      <input type="text" class="detail-name-input" id="nameInput" value="${person.name || ''}" 
             onchange="saveDetailField('name', this.value)"
             onclick="event.stopPropagation();"
             placeholder="Nom">
    `;
  } else {
    nameWrapper.innerHTML = `<div class="detail-name" id="detailName">${person.name || 'Nom inconnu'}</div>`;
  }
  
  const genderCard = document.getElementById('detailGenderCard');
  const genderValue = document.getElementById('detailGender');
  const genderText = person.gender === 'male' ? 'Homme' : person.gender === 'female' ? 'Femme' : 'Non renseigné';
  
  if (canEdit) {
    genderCard.classList.add('editable');
    genderValue.innerHTML = `
      <select class="detail-value-select" id="genderSelect" onchange="saveDetailField('gender', this.value)">
        <option value="male" ${person.gender === 'male' ? 'selected' : ''}>Homme</option>
        <option value="female" ${person.gender === 'female' ? 'selected' : ''}>Femme</option>
        <option value="unknown" ${person.gender === 'unknown' || !person.gender ? 'selected' : ''}>Non renseigné</option>
      </select>
    `;
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
    birthValue.innerHTML = `
      <input type="date" class="detail-value-input" id="birthInput" value="${person.birth || ''}" 
             onchange="saveDetailField('birth', this.value)" 
             onclick="event.stopPropagation();">
    `;
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
    bioValue.innerHTML = `
      <textarea class="detail-value-textarea" id="bioInput" rows="2" 
                placeholder="Courte biographie..." 
                onchange="saveDetailField('bio', this.value)" 
                onclick="event.stopPropagation();"
                style="resize: vertical; min-height: 50px;">${person.bio || ''}</textarea>
    `;
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

// ============================================
// AJOUT / MODIFICATION / SUPPRESSION
// ============================================

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

// ============================================
// HISTORIQUE DES INFORMATIONS
// ============================================

let isHistoryEditMode = false;

window.openHistoryModal = async function() {
  familyHistory = await loadFamilyHistoryDB();
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
  
  const saved = await saveFamilyHistoryDB(newContent);
  if (saved) {
    document.getElementById("historyTextDisplay").innerHTML = newContent.replace(/\n/g, '<br>');
    await addJournalEntry('edit', 'edit', 'Informations de la famille modifiées', 'proprietaire');
    showToast("Informations mises à jour avec succès !", "success");
    cancelHistoryEdit();
  } else {
    showToast("Erreur lors de la sauvegarde", "error");
  }
};

// ============================================
// CACHE & LOAD PASSWORDS
// ============================================

async function loadPasswords() {
  const data = await loadPasswordsDB();
  if (data) {
    passwords = data;
    return true;
  }
  return false;
}

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

// ============================================
// INITIALISATION
// ============================================

async function init() {
  await loadPasswords();
  await chargerfamille();
  journalEntries = await loadJournal();
  familyHistory = await loadFamilyHistoryDB();
  buildNameIndex();
  updateUIForAuth();
  
  // Initialiser les statistiques
  await initStats();
}

// Démarrer
init();

// Exposer les fonctions globales
window.findNodeWithParent = findNodeWithParent;
window.findPathToNode = findPathToNode;
window.buildNameIndex = buildNameIndex;
window.countNodes = countNodes;
window.sauvegarderFamille = sauvegarderFamille;
window.family = family;
window.getPathToNode = getPathToNode;
window.currentDetailPerson = currentDetailPerson;
window.findNodeByName = findNodeByName;
window.updateStatsUI = updateStatsUI;

// Service Worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js");
  });
}