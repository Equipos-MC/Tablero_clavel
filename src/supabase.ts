import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://mrcznslxuqlwoellqbqh.supabase.co";
const supabasePublishableKey = "sb_publishable_dIreh7SxYY7ASqjiFv60pA_LSP7TQtC";

export const supabase = createClient(supabaseUrl, supabasePublishableKey);

