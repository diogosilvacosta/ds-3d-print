const SB_URL = "https://wxwdvixxcrduzneqjfwo.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind4d2R2aXh4Y3JkdXpuZXFqZndvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMTg0MDEsImV4cCI6MjA4Nzc5NDQwMX0.WKs7b9PMec_AxbU2TThK_TdiyhN8pamiUFN1H2z36aM";
const REMOVE_BG_KEY = "KYm3knsGAoS6YhcghA9gqmwL";
const CHAVE_OPERACOES = "interno_stock_vendas";
const CHAVE_BANNER = "banner";
const adminSupabase = supabase.createClient(SB_URL, SB_KEY);

function formatEuro(valor) {
    return `${(Number(valor) || 0).toFixed(2)} EUR`;
}

function adminLogin() {
    const user = document.getElementById("user").value.trim().toLowerCase();
    const pass = document.getElementById("pass").value;
    const valido =
        (user === "diogo" && pass === "Requiao0829") ||
        (user === "jessica" && pass === "Requiao0829");

    if (!valido) {
        alert("Acesso negado.");
        return false;
    }

    localStorage.setItem("ds_logged", "true");
    localStorage.setItem("ds_admin_user", user);
    location.reload();
    return true;
}

function logout() {
    localStorage.removeItem("ds_logged");
    localStorage.removeItem("ds_admin_user");
    location.href = "admin.html";
}

async function setupAdminPage(onReady) {
    const loginSection = document.getElementById("login-section");
    const appShell = document.getElementById("app-shell");
    const logged = localStorage.getItem("ds_logged") === "true";

    if (!logged) {
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

async function saveBannerState(ativo, valor) {
    return adminSupabase
        .from("config_site")
        .upsert({ chave: CHAVE_BANNER, ativo, valor }, { onConflict: "chave" });
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
