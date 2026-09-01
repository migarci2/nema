# nema

> The web teaches. Your vault remembers. Your agent connects the two.

Marca: **nema**. Protocolo: `nema/0.1`. Namespace de conceptos: `nema:`.
Target: The WebMCP Challenge (webmcp.devpost.com).

## 1. Contrato del hackathon (verificado 2026-09-01)

| Item | Valor |
|---|---|
| Deadline | 3 sep 2026, 13:00 PDT (22:00 CEST). Quedan ~48 h. |
| Judging | 4 sep a 21 sep. Ganadores ~23 sep. |
| Premio | 10 ganadores x ~3.500 USD + creditos (Cloudflare 10k, Vercel 4.2k, etc.). Un premio por proyecto. |
| Entregables | URL viva, repo publico con licencia OSS visible en About, video YouTube < 3 min con audio, texto de descripcion. |
| Como prueban | ChatGPT desktop (in-app browser, WebMCP por defecto) o Chrome 149+ con `chrome://flags/#enable-webmcp-testing`. |
| Criterios (peso igual) | WebMCP leverage, Execution (producto completo, no PoC), Potential impact, Creativity & ambition. |
| Fase 1 | Pass/fail de viabilidad. Si el tool registration no funciona, fuera. |
| Texto obligatorio | Por que WebMCP encaja, como mejora la UX, que colaboracion humano-agente habilita, como esta implementado. |
| Prior work | Debe ser nuevo en el periodo (25 ago a 3 sep). Commits fechados. |

API real (spec + demos de Chrome Labs):

```js
await document.modelContext.registerTool({
  name: "stage_evidence_receipt",
  description: "...",
  inputSchema: { type: "object", properties: {...}, required: [...] },
  async execute({ receipt }) { return { accepted: true, ... }; }
});
```

Tambien existe la forma declarativa `<form toolname tooldescription toolautosubmit>` con `toolparamdescription` en inputs. Chrome Labs publica un polyfill (`demos/shared/webmcp-polyfill.js`) para navegadores sin soporte: lo reutilizamos para que la UI funcione en cualquier navegador y para grabar el video sin depender del flag.

Limitacion clave: WebMCP es per-document. No hay composicion de tools entre pestañas. El agente transporta strings entre sitios. Diseño: **handoff secuencial**, los objetos firmados viajan como tokens compactos que caben en el contexto del agente.

## 2. Alcance a 48 horas

El documento largo es la tesis. Esto es lo que se construye.

### Se construye

```
nema/
  apps/vault/       una pagina. IndexedDB via localStorage JSON. 7 tools.
  apps/harness/     Harness Engineering Lab. 1 diagnostico + 1 lab. 5 tools.
  apps/security/    Agent Security. 1 lab avanzado bloqueado por prerequisitos. 4 tools.
  shared/
    concepts.json   20-25 conceptos nema:*, con prerequisitos y aliases por proveedor.
    crypto.js       ECDSA P-256 via Web Crypto. sign/verify de tokens compactos.
    protocol.js     builders/validators de Manifest, Assertion, Receipt, Need.
    webmcp-polyfill.js  copiado de Chrome Labs (Apache-2.0).
  test/protocol.test.js   node --test. 8 asserts.
  README.md          respuesta a las 4 preguntas del formulario + instrucciones.
  LICENSE            MIT.
```

Sin build. HTML + ES modules. Cada app es un origen distinto: tres Workers con static assets en Cloudflare (`nema-vault`, `nema-harness`, `nema-security` en workers.dev). Tres origenes reales hacen creible el "0 shared accounts".

### Se corta (y cuando volver)

| Cortado | Sustituto | Volver cuando |
|---|---|---|
| Provider SDK y Vault SDK como paquetes | `shared/protocol.js` importado por los tres | haya un tercer proveedor externo |
| Conformance suite | un test file con 8 asserts | despues del hackathon |
| PWA, OPFS, export cifrado | localStorage + boton "export JSON" | haya usuarios reales |
| Registry de conceptos gobernado | JSON de 20-25 conceptos revisado a mano | haya mas de 2 proveedores |
| StateDelta como objeto publico | el vault devuelve un diff legible en el resultado del tool | nunca, probablemente |
| Scheduler SRS formal | heuristica `priority = riesgo x relevancia x gap / minutos` | tengamos datos |
| Ejercicios generados bajo blueprint con rubrica | el vault devuelve un `LearningNeed` con rubrica; el agente hace la pregunta en el chat y registra el resultado con `record_agent_assessment` (confianza media, visible en el ledger) | ya esta, es la version barata |
| Identidades pseudonimas por proveedor | un `learnerKeyId` por proveedor derivado con HKDF del key del vault | fase 2 |

## 3. Tools WebMCP

### vault (nema-vault)

| Tool | Que hace |
|---|---|
| `get_vault_summary` | conteos: conceptos, verified, fragile, reviews due. Nunca el historial. |
| `create_readiness_assertion` | entrada: audience, purpose, requirements[]. Muestra panel de disclosure al usuario, espera aprobacion, devuelve token firmado con expiracion 30 min y bound al audience. |
| `stage_evidence_receipt` | entrada: token. Verifica firma contra registry de issuers, dedup por receiptId, actualiza learner state, devuelve el diff. |
| `get_learning_needs` | entrada: budgetMinutes. Devuelve needs priorizados con rubrica. |
| `record_agent_assessment` | entrada: needId, rubricResults[]. Genera receipt `agent_assessed` de confianza media. |
| `get_disclosure_ledger` | que se compartio con quien y cuando expira. |
| `get_evidence_ledger` | lista de receipts aceptados, issuer, claims, efecto. |

Tools que no existen y el README lo dice: `set_mastery`, `get_full_history`, `submit_answer_for_learner`.

### harness (nema-harness)

| Tool | Que hace |
|---|---|
| `describe_learning_offer` | devuelve el LearningManifest. |
| `personalize_learning_path` | entrada: assertion token. Verifica firma del vault, audience y expiracion. Devuelve ruta recortada (68 min a 27 min). |
| `start_diagnostic` | abre la pregunta de JSON Schema en la UI. El humano responde. |
| `start_lab` | abre el lab "arregla el harness". Grader determinista. |
| `issue_evidence_receipt` | tras superar la actividad, devuelve token firmado. Solo si el grader dijo pass. |

### security (nema-security)

| Tool | Que hace |
|---|---|
| `describe_learning_offer` | manifest con 3 prerequisitos. |
| `check_prerequisites` | entrada: assertion token. Reconoce evidencia de harness. Desbloquea el lab avanzado. |
| `start_lab` | lab "feedback-loop attack surface". |
| `issue_evidence_receipt` | igual que harness. |

Regla de oro para Execution: cada tool cambia algo visible en pantalla. El jurado tiene que ver la UI moverse cuando el agente llama.

## 4. Formato de los tokens

Receipt y assertion viajan como `base64url(payload).base64url(signature)`. Objetivo: < 800 caracteres, para que el agente los copie sin romperlos. El vault y los proveedores muestran el token en un `<textarea>` con boton copiar, como fallback manual si el agente lo mutila.

Claves: cada app genera su par ECDSA P-256 en primer arranque y lo guarda en localStorage. Para la demo, las claves publicas de harness y security estan hardcodeadas en `shared/issuers.json` (generadas una vez, commit). El vault confia solo en esas dos. Un issuer desconocido queda `pending` en el ledger, no se descarta.

## 5. Guion del video (2:55)

Igual al del documento, con tres cambios:

1. Abrir con el vault en 15 s, no 20. Mensaje en pantalla: "Your learning state belongs to you, not to the websites you visit."
2. Mostrar el panel de disclosure en pantalla completa 4 s. Es el momento que diferencia esto de todo lo demas del showcase.
3. Cerrar con `2 independent websites / 1 learner-owned vault / 0 shared accounts` y la URL.

Grabar en ChatGPT desktop si el in-app browser mantiene la conversacion al navegar entre origenes. Si no, Chrome 149 con flag. Probar esto el dia 1 antes de nada.

## 6. Plan por horas

| Cuando | Que |
|---|---|
| Dia 1 manana | Repo, LICENSE, `shared/` (crypto, protocol, concepts), test. Vault con las 7 tools y UI minima. Deploy de los tres Workers vacios para tener las URLs. |
| Dia 1 tarde | Harness: manifest, diagnostico, lab, receipt. Handoff harness a vault funcionando de verdad en Chrome 149. |
| Dia 1 noche | Probar en ChatGPT desktop. Decidir navegador para el video. |
| Dia 2 manana | Security: check_prerequisites + lab. Disclosure ledger y evidence ledger en el vault. `get_learning_needs` + `record_agent_assessment`. |
| Dia 2 tarde | Pulido visual, README con las 4 respuestas, video. |
| Dia 2 noche | Subir video, submit en Devpost antes de las 20:00 CEST. Margen de 2 h. |

## 7. Riesgos

| Riesgo | Mitigacion |
|---|---|
| El agente corrompe el token al transportarlo | tokens cortos, textarea con copiar, `get_last_receipt` en el proveedor |
| ChatGPT in-app browser pierde contexto al cambiar de origen | probar el dia 1; fallback: Chrome 149 y el agente de pruebas del propio Chrome |
| Fase 1 pass/fail por tool registration rota | usar `document.modelContext` exacto como en los demos de Chrome Labs; polyfill solo si `!document.modelContext` |
| Jurado no entiende el protocolo en 3 min | el video muestra pantallas, no JSON. El JSON va en el README |

## 8. Texto para Devpost (borrador, ingles)

**Why WebMCP.** Learning happens across many sites but the learner's state is trapped in each of them. WebMCP lets every site expose what it can teach and what evidence it produced, and lets a learner-owned vault expose purpose-bound readiness, all as first-class tools an agent can compose. No API keys, no shared accounts, no scraping.

**How it improves UX.** The learner never starts from zero. A site asks for three prerequisites, the vault answers with three status bands, and a 68-minute path becomes 27. A second, unrelated site recognises the first site's signed receipt and unlocks its advanced lab.

**Human and agent collaboration.** The agent brokers: it reads manifests, negotiates disclosure, carries signed receipts, and coaches with the vault's learning needs. The human answers every question, approves every disclosure, and owns the ledger. The agent cannot write mastery, invent evidence, or answer on the learner's behalf.

**Implementation.** Three origins, each registering tools with `document.modelContext.registerTool`. Receipts and assertions are ECDSA-signed compact tokens, audience-bound and expiring. The vault keeps an evidence ledger and derives learner state from it, so the state is recomputable and auditable. Built with plain HTML and ES modules, deployed on Cloudflare Workers.
