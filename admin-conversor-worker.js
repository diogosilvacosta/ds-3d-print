// Corre a conversão fora da página, para o admin não congelar com modelos grandes
import { convert } from './admin-conversor.js';
self.onmessage = async (e) => {
    try {
        const r = await convert(e.data.buf, e.data.name);
        self.postMessage({ ok: true, ...r }, [r.glb.buffer]);
    } catch (err) {
        self.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
    }
};
