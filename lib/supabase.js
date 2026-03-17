const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// Safety check (so you don’t debug blindly again)
if (!supabaseUrl) {
  throw new Error("SUPABASE_URL is missing in environment variables");
}

if (!supabaseKey) {
  throw new Error("SUPABASE_KEY is missing in environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
