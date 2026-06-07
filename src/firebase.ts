import { initializeApp, getApp, getApps } from 'firebase/app';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  updateDoc, 
  deleteDoc, 
  collection, 
  query, 
  where, 
  orderBy,
  Firestore
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

let dbInstance: Firestore | null = null;
let isInitialized = false;

// Safe initializer checking if Firebase has been configured in the environment
export function getFirebaseDB(): Firestore | null {
  if (dbInstance) return dbInstance;
  
  if (firebaseConfig && firebaseConfig.apiKey && firebaseConfig.apiKey.trim() !== "") {
    try {
      const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
      dbInstance = firebaseConfig.firestoreDatabaseId 
        ? getFirestore(app, firebaseConfig.firestoreDatabaseId) 
        : getFirestore(app);
      isInitialized = true;
      console.log("Firebase Firestore successfully initialized!");
      return dbInstance;
    } catch (e) {
      console.error("Failed to initialize Firebase app:", e);
    }
  }
  return null;
}

export function isFirebaseEnabled(): boolean {
  getFirebaseDB();
  return isInitialized;
}

// Error logger according to the Firebase integration skill's required pattern
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {},
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// 1. Submit a line to Firestore
export async function submitLineToFirebase(submissionData: any): Promise<boolean> {
  const db = getFirebaseDB();
  if (!db) return false;
  
  const path = `submissions/${submissionData.id}`;
  try {
    await setDoc(doc(db, 'submissions', submissionData.id), {
      id: submissionData.id,
      name: submissionData.name,
      creatorNickname: submissionData.creatorNickname || '',
      city: submissionData.city || '全国',
      district: submissionData.district || '',
      path: submissionData.path,
      via_stops: submissionData.via_stops || [],
      status: submissionData.status || 'pending',
      timestamp: submissionData.timestamp || Date.now()
    });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
    return false;
  }
}

// 2. Fetch approved lines from Firestore
export async function fetchApprovedLinesFromFirebase(): Promise<any[]> {
  const db = getFirebaseDB();
  if (!db) return [];
  
  const path = 'submissions';
  try {
    const q = query(
      collection(db, 'submissions'), 
      where('status', '==', 'approved'),
      orderBy('timestamp', 'desc')
    );
    const querySnapshot = await getDocs(q);
    const approvedLines: any[] = [];
    querySnapshot.forEach((docSnap) => {
      approvedLines.push(docSnap.data());
    });
    return approvedLines;
  } catch (error) {
    // If it's a missing index error, fallback to un-indexed map scan
    try {
      const q = query(collection(db, 'submissions'), where('status', '==', 'approved'));
      const querySnapshot = await getDocs(q);
      const approvedLines: any[] = [];
      querySnapshot.forEach((docSnap) => {
        approvedLines.push(docSnap.data());
      });
      return approvedLines.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    } catch (innerError) {
      handleFirestoreError(innerError, OperationType.LIST, path);
      return [];
    }
  }
}

// 3. Batch check statuses of user's past drawn submission IDs
export async function checkSubmissionStatusFromFirebase(ids: string[]): Promise<Record<string, string>> {
  const db = getFirebaseDB();
  const statuses: Record<string, string> = {};
  if (!db || ids.length === 0) return statuses;
  
  const path = 'submissions';
  try {
    // Firestore in clause supports maximum 10 elements. Let's batch check.
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += 10) {
      batches.push(ids.slice(i, i + 10));
    }
    
    for (const batch of batches) {
      if (batch.length === 0) continue;
      const q = query(collection(db, 'submissions'), where('id', 'in', batch));
      const querySnapshot = await getDocs(q);
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (data && data.id) {
          statuses[data.id] = data.status;
        }
      });
    }
    return statuses;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return statuses;
  }
}

// 4. Fetch pending items for admin panel
export async function getPendingSubmissionsFromFirebase(): Promise<any[]> {
  const db = getFirebaseDB();
  if (!db) return [];
  
  const path = 'submissions';
  try {
    const q = query(
      collection(db, 'submissions'), 
      where('status', '==', 'pending'),
      orderBy('timestamp', 'desc')
    );
    const querySnapshot = await getDocs(q);
    const pendingLines: any[] = [];
    querySnapshot.forEach((docSnap) => {
      pendingLines.push(docSnap.data());
    });
    return pendingLines;
  } catch (error) {
    try {
      const q = query(collection(db, 'submissions'), where('status', '==', 'pending'));
      const querySnapshot = await getDocs(q);
      const pendingLines: any[] = [];
      querySnapshot.forEach((docSnap) => {
        pendingLines.push(docSnap.data());
      });
      return pendingLines.sort((a, b) => b.timestamp - a.timestamp);
    } catch (innerError) {
      handleFirestoreError(innerError, OperationType.LIST, path);
      return [];
    }
  }
}

// 5. Approve or reject a submission
export async function updateSubmissionStatusInFirebase(id: string, status: 'approved' | 'rejected'): Promise<boolean> {
  const db = getFirebaseDB();
  if (!db) return false;
  
  const path = `submissions/${id}`;
  try {
    await updateDoc(doc(db, 'submissions', id), { status });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
    return false;
  }
}

// 6. Edit an approved line's name
export async function editApprovedLineInFirebase(id: string, newName: string): Promise<boolean> {
  const db = getFirebaseDB();
  if (!db) return false;
  
  const path = `submissions/${id}`;
  try {
    await updateDoc(doc(db, 'submissions', id), { name: newName });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
    return false;
  }
}

// 7. Delete an approved/pending line
export async function deleteApprovedLineInFirebase(id: string): Promise<boolean> {
  const db = getFirebaseDB();
  if (!db) return false;
  
  const path = `submissions/${id}`;
  try {
    await deleteDoc(doc(db, 'submissions', id));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
    return false;
  }
}
