import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: "AIzaSyBEt4x6pADAoGPg_FCfMHszq64KGyjHVnw",
  authDomain: "genealogie-mignot-game.firebaseapp.com",
  databaseURL: "https://genealogie-mignot-game-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "genealogie-mignot-game",
  storageBucket: "genealogie-mignot-game.firebasestorage.app",
  messagingSenderId: "414761684967",
  appId: "1:414761684967:web:af32ca28170bb2020bb742"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);