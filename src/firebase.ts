import firebaseConfig from '../firebase-applet-config.json';

// Return true if firebase configuration is declared in metadata/config
export function isFirebaseEnabled(): boolean {
  return !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.apiKey.trim() !== "");
}

// Return null since Firestore instance is no longer needed on the client-side
export function getFirebaseDB(): any {
  return null;
}

// 1. Submit a line to Firestore (delegated via Server Proxy API)
export async function submitLineToFirebase(submissionData: any): Promise<boolean> {
  try {
    const res = await fetch('/api/submissions/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submissionData)
    });
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    return !!data.success;
  } catch (error) {
    console.error('Proxy Submit Error:', error);
    return false;
  }
}

// 2. Fetch approved lines from Firestore (delegated via Server Proxy API)
export async function fetchApprovedLinesFromFirebase(): Promise<any[]> {
  try {
    const res = await fetch('/api/submissions/approved');
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    return data || [];
  } catch (error) {
    console.error('Proxy Fetch Approved Error:', error);
    return [];
  }
}

// 3. Batch check statuses of user's past drawn submission IDs (delegated via Server Proxy API)
export async function checkSubmissionStatusFromFirebase(ids: string[]): Promise<Record<string, string>> {
  try {
    if (ids.length === 0) return {};
    const res = await fetch(`/api/submissions/status?ids=${encodeURIComponent(ids.join(','))}`);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    return data || {};
  } catch (error) {
    console.error('Proxy Fetch Status Error:', error);
    return {};
  }
}

// 4. Fetch pending items for admin panel (delegated via Server Proxy API)
export async function getPendingSubmissionsFromFirebase(): Promise<any[]> {
  try {
    const res = await fetch('/api/admin/pending');
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    return data || [];
  } catch (error) {
    console.error('Proxy Fetch Pending Error:', error);
    return [];
  }
}

// 5. Approve or reject a submission (delegated via Server Proxy API)
export async function updateSubmissionStatusInFirebase(id: string, status: 'approved' | 'rejected'): Promise<boolean> {
  try {
    const endpoint = status === 'approved' ? '/api/admin/approve' : '/api/admin/reject';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    return !!data.success;
  } catch (error) {
    console.error('Proxy Update Status Error:', error);
    return false;
  }
}

// 6. Edit an approved line's name (delegated via Server Proxy API)
export async function editApprovedLineInFirebase(id: string, newName: string): Promise<boolean> {
  try {
    const res = await fetch('/api/admin/edit-approved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: newName })
    });
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    return !!data.success;
  } catch (error) {
    console.error('Proxy Edit Approved Error:', error);
    return false;
  }
}

// 7. Delete an approved/pending line (delegated via Server Proxy API)
export async function deleteApprovedLineInFirebase(id: string): Promise<boolean> {
  try {
    const res = await fetch('/api/admin/delete-approved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    return !!data.success;
  } catch (error) {
    console.error('Proxy Delete Approved Error:', error);
    return false;
  }
}
