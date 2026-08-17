/*
  Supabase client connection file.

  Is file ko `index.html` me `script.js` se pehle load karna zaroori hai.
  Ye `window.supabaseClient` create karta hai, jise main app script use karta hai:
  - OTP login/register
  - profile data
  - cart/wishlist/orders sync
  - saved address/UPI sync
  - Edge Function calls

  Security note:
  SUPABASE_KEY yaha anon public key hai. Service role key kabhi frontend me nahi rakhni.
*/

// Supabase project URL: tumhare Supabase project ka public API endpoint.
const SUPABASE_URL = 'https://eohyhutadbpghjvbwecv.supabase.co';

// Supabase anon key: browser app authenticated user operations ke liye use karti hai.
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVvaHlodXRhZGJwZ2hqdmJ3ZWN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5NzMyODUsImV4cCI6MjA5NDU0OTI4NX0.-ZWFuz02rKdE9IAo25HtuC0bWho1mhdECqtGdPCxM1A';

// CDN Supabase library agar load nahi hui to app ko clear error do.
if (!window.supabase?.createClient) {
  throw new Error("Supabase library not loaded. Check the CDN script in index.html.");
}

// Single shared client. Main script isi global client ko read karta hai.
const supabaseClient = window.supabase.createClient(
  SUPABASE_URL , 
  SUPABASE_KEY
);
window.supabaseClient = supabaseClient;
console.log("Supabase Connected");