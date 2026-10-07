const SB_URL = "https://wxwdvixxcrduzneqjfwo.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind4d2R2aXh4Y3JkdXpuZXFqZndvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMTg0MDEsImV4cCI6MjA4Nzc5NDQwMX0.WKs7b9PMec_AxbU2TThK_TdiyhN8pamiUFN1H2z36aM";
// NOTA: esta chave (anon) e publica por natureza - a seguranca vem das RLS policies no Supabase.
// A chave do remove.bg foi removida daqui: nunca colocar chaves privadas em ficheiros servidos ao browser.
const CHAVE_OPERACOES = "interno_stock_vendas";
const CHAVE_BANNER = "banner";
const ADMIN_EMAIL_DOMAIN = "ds3dprint.com";
const adminSupabase = supabase.createClient(SB_URL, SB_KEY);

function formatEuro(valor) {
    return `${(Number(valor) || 0).toFixed(2)} EUR`;
}

// ── AUTENTICACAO (Supabase Auth) ──────────────────────────────
// O login agora e validado no servidor. E preciso criar os utilizadores
// no Supabase: Authentication > Users > Add user
// (ex: diogo@ds3dprint.com e jessica@ds3dprint.com, com password forte).
// No campo "Utilizador" pode escrever-se so o nome (diogo) ou o email completo.

async function adminLogin() {
    const userInput = document.getElementById("user").value.trim().toLowerCase();
    const pass = document.getElementById("pass").value;

    if (!userInput || !pass) {
        alert("Preenche o utilizador e a password.");
        return false;
    }

    const email = userInput.includes("@") ? userInput : `${userInput}@${ADMIN_EMAIL_DOMAIN}`;

    const { error } = await adminSupabase.auth.signInWithPassword({ email, password: pass });

    if (error) {
        alert("Acesso negado.");
        return false;
    }

    localStorage.setItem("ds_admin_user", email.split("@")[0]);
    location.reload();
    return true;
}

async function logout() {
    await adminSupabase.auth.signOut();
    localStorage.removeItem("ds_admin_user");
    localStorage.removeItem("ds_logged"); // limpeza do sistema antigo
    location.href = "admin.html";
}

async function setupAdminPage(onReady) {
    const loginSection = document.getElementById("login-section");
    const appShell = document.getElementById("app-shell");

    const { data: { session } } = await adminSupabase.auth.getSession();

    if (!session) {
        if (loginSection) loginSection.classList.remove("hidden");
        if (appShell) appShell.classList.add("hidden");
        return;
    }

    if (loginSection) loginSection.classList.add("hidden");
    if (appShell) appShell.classList.remove("hidden");

    if (typeof onReady === "function") {
        await onReady();
    }
}

function wireLoginEnter() {
    const pass = document.getElementById("pass");
    if (!pass) return;
    pass.addEventListener("keydown", (event) => {
        if (event.key === "Enter") adminLogin();
    });
}

// ── OPERACOES / BANNER (inalterado) ───────────────────────────

async function loadOperacoesState() {
    try {
        const { data } = await adminSupabase
            .from("config_site")
            .select("*")
            .eq("chave", CHAVE_OPERACOES)
            .single();

        const raw = data && data.valor ? JSON.parse(data.valor) : {};
        return {
            stock: raw && raw.stock && typeof raw.stock === "object" ? raw.stock : {},
            movimentos: Array.isArray(raw && raw.movimentos) ? raw.movimentos : []
        };
    } catch (error) {
        return { stock: {}, movimentos: [] };
    }
}

async function saveOperacoesState(state) {
    const payload = JSON.stringify(state);
    const { error } = await adminSupabase
        .from("config_site")
        .upsert({ chave: CHAVE_OPERACOES, ativo: true, valor: payload }, { onConflict: "chave" });
    return { error };
}

async function loadBannerState() {
    try {
        const { data } = await adminSupabase
            .from("config_site")
            .select("*")
            .eq("chave", CHAVE_BANNER)
            .single();
        return data || null;
    } catch (error) {
        return null;
    }
}

async function upsertBannerState(ativo, valor) {
    return adminSupabase
        .from("config_site")
        .upsert({ chave: CHAVE_BANNER, ativo: Boolean(ativo), valor }, { onConflict: "chave" });
}

// Chave remove.bg: pedida uma vez e guardada apenas no browser do admin,
// nunca no codigo publico. (A chave antiga estava exposta - deve ser revogada
// em remove.bg e criada uma nova.)
function getRemoveBgKey() {
    let key = (localStorage.getItem("ds_removebg_key") || "").trim();
    if (!key) {
        key = (prompt("Cola a tua chave da API remove.bg (fica guardada so neste browser):") || "").trim();
        if (key) localStorage.setItem("ds_removebg_key", key);
    }
    return key;
}

function firstImage(urls) {
    return String(urls || "").split(",")[0].trim();
}

function normalizeKeywords(nome) {
    return nome.toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z\s]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 4);
}
