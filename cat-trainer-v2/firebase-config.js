// Firebase project config for the family's Cat Trainer backend.
// These values are NOT secret — they only identify the project. Access is
// protected by the Firestore security rules, not by hiding this file.
// SDK version pinned to match the project: 12.17.1.

export const FIREBASE_SDK_VERSION = '12.17.1';

export const firebaseConfig = {
  apiKey: 'AIzaSyCRagkh-5QNCe37PZTviYaJxnUn1SeGE6M',
  authDomain: 'xiatea-afc59.firebaseapp.com',
  projectId: 'xiatea-afc59',
  storageBucket: 'xiatea-afc59.firebasestorage.app',
  messagingSenderId: '202758488500',
  appId: '1:202758488500:web:a724c7ce1299bc21d2f2e1',
  measurementId: 'G-EHEYZ01ECS'
};

export const isConfigured = !firebaseConfig.apiKey.startsWith('PASTE_');
