// firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDh1sYrwm5dTG3ktVHprKzE3Gr7fRmxOzfQ",
  authDomain: "gaway-290bc.firebaseapp.com",
  projectId: "gaway-290bc",
  storageBucket: "gaway-290bc.firebasestorage.app",
  messagingSenderId: "1061998444067",
  appId: "1:1061998444067:web:4979bcd90e56f42fd4bb96"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db };
