// Interfaz de la DApp Cachipún On-Chain.
// Lee el estado del contrato (con MetaMask o, sin wallet, con un RPC público)
// y envía las transacciones firmadas con MetaMask.
import { ethers } from "ethers";
import {
  Estado,
  Jugada,
  NOMBRE_ESTADO,
  NOMBRE_JUGADA,
  EMOJI_JUGADA,
  REDES,
  calcularHash,
  nuevoSecreto,
  conectarContrato,
} from "./contrato.js";

const INTERVALO_MS = 5000;
const $ = (selector) => document.querySelector(selector);

const app = {
  claveRed: "sepolia",
  red: REDES.sepolia,
  rpc: null,          // proveedor del RPC público (modo espectador)
  lector: null,       // proveedor con el que se lee: MetaMask si está conectada, si no el RPC
  fuente: "",
  wallet: null,       // ethers.BrowserProvider sobre window.ethereum
  firmante: null,
  cuenta: null,
  direccion: null,    // dirección del contrato cargado
  contrato: null,
  datos: null,        // último estado leído del contrato
  eventos: [],
  ultimoBloque: -1,
  bloqueActual: null,
  errorLectura: null,
  refrescando: false,
  ocupado: false,     // hay una transacción en curso
  vencido: false,     // venció el plazo de la fase actual
  clavePanel: "",
  jugadaElegida: null,
  monto: "0.001",
  manualJugada: "1",
  manualSecreto: "",
};

// ─────────────────────────── Utilidades ───────────────────────────

function leerLocal(clave) {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}

function guardarLocal(clave, valor) {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    // Sin almacenamiento (modo privado): el respaldo manual sigue disponible.
  }
}

const corta = (direccion) => (direccion ? `${direccion.slice(0, 6)}…${direccion.slice(-4)}` : "—");
const eth = (wei) => `${ethers.formatEther(wei)} ETH`;
const esCero = (direccion) => !direccion || direccion === ethers.ZeroAddress;
const mismo = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const jugadaTexto = (j) => (j ? `${EMOJI_JUGADA[j]} ${NOMBRE_JUGADA[j]}` : "—");

function escapar(texto) {
  const reemplazos = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(texto ?? "").replace(/[&<>"']/g, (c) => reemplazos[c]);
}

function linkTx(hash, texto = "ver tx") {
  if (!app.red.explorador) return `<span class="mono">${hash.slice(0, 10)}…</span>`;
  return `<a href="${app.red.explorador}/tx/${hash}" target="_blank" rel="noopener">${texto} ↗</a>`;
}

function linkDireccion(direccion) {
  if (!app.red.explorador) return `<span class="mono" title="${direccion}">${corta(direccion)}</span>`;
  return `<a class="mono" href="${app.red.explorador}/address/${direccion}" target="_blank" rel="noopener" title="${direccion}">${corta(direccion)}</a>`;
}

function mensajeDeError(e) {
  if (e?.code === "ACTION_REJECTED" || e?.code === 4001) return "cancelaste la transacción en MetaMask.";
  if (e?.reason) return e.reason;
  return e?.shortMessage || e?.message || String(e);
}

function avisar(texto, tipo = "info", esHtml = false) {
  const caja = $("#aviso");
  caja.className = `aviso ${tipo}`;
  if (esHtml) caja.innerHTML = texto;
  else caja.textContent = texto;
  caja.hidden = false;
  clearTimeout(avisar.temporizador);
  avisar.temporizador = setTimeout(() => (caja.hidden = true), tipo === "error" ? 15000 : 9000);
}

async function copiar(texto, mensaje) {
  try {
    await navigator.clipboard.writeText(texto);
    avisar(mensaje, "ok");
  } catch {
    window.prompt("Copia este texto:", texto);
  }
}

// ─────────────────────────── Estado derivado ───────────────────────────

function rol() {
  const d = app.datos;
  if (!d || !app.cuenta) return null;
  if (mismo(d.j1.addr, app.cuenta)) return 1;
  if (mismo(d.j2.addr, app.cuenta)) return 2;
  return null;
}

function miJugador() {
  const r = rol();
  if (r === 1) return app.datos.j1;
  if (r === 2) return app.datos.j2;
  return null;
}

/** Plazo de la fase en curso, o null si no hay ninguno corriendo. */
function plazoVigente() {
  const d = app.datos;
  if (!d) return null;
  if (d.estado === Estado.EsperandoJugadores) {
    return esCero(d.j1.addr) ? null : { tipo: "commit", hasta: Number(d.plazoCommit) };
  }
  if (d.estado === Estado.Comprometiendo) return { tipo: "commit", hasta: Number(d.plazoCommit) };
  if (d.estado === Estado.Revelando) return { tipo: "reveal", hasta: Number(d.plazoReveal) };
  return null;
}

function calcularVencido() {
  const plazo = plazoVigente();
  return !!plazo && Date.now() / 1000 > plazo.hasta;
}

function formatoRestante(segundos) {
  if (segundos <= 0) return "vencido";
  const dos = (n) => String(n).padStart(2, "0");
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = segundos % 60;
  return h ? `${h}:${dos(m)}:${dos(s)}` : `${dos(m)}:${dos(s)}`;
}

function claveSecreto(partida, ronda) {
  return `cachipun:secreto:${app.red.chainId}:${app.direccion}:${partida}:${ronda}:${app.cuenta}`.toLowerCase();
}

function leerSecretoGuardado() {
  const d = app.datos;
  if (!d || !app.cuenta) return null;
  try {
    const guardado = JSON.parse(leerLocal(claveSecreto(d.partida, d.ronda)) ?? "null");
    return guardado && typeof guardado.secreto === "string" ? guardado : null;
  } catch {
    return null;
  }
}

function aJugador(r) {
  return {
    addr: r.addr,
    jugada: Number(r.jugada),
    comprometio: r.comprometio,
    revelo: r.revelo,
    victorias: Number(r.victorias),
    hash: r.hash,
  };
}

// ─────────────────────────── Conexión ───────────────────────────

function usarLector(proveedor, fuente) {
  app.lector = proveedor;
  app.fuente = fuente;
  if (app.direccion) app.contrato = conectarContrato(app.direccion, proveedor);
}

async function conectarWallet(pedirPermiso) {
  if (!window.ethereum) {
    avisar("No se detectó MetaMask. Puedes mirar la partida en modo espectador.", "error");
    return;
  }
  try {
    const wallet = new ethers.BrowserProvider(window.ethereum);
    const cuentas = await wallet.send(pedirPermiso ? "eth_requestAccounts" : "eth_accounts", []);
    if (!cuentas.length) {
      app.wallet = app.firmante = app.cuenta = null;
      usarLector(app.rpc, app.red.fuente);
      render();
      return;
    }
    const { chainId } = await wallet.getNetwork();
    if (chainId !== app.red.chainId) {
      if (pedirPermiso) await cambiarRed(); // MetaMask emite chainChanged y la página se recarga
      else avisar(`MetaMask está en otra red. Presiona “Conectar” para cambiar a ${app.red.nombre}.`, "error");
      return;
    }
    app.wallet = wallet;
    app.firmante = await wallet.getSigner();
    app.cuenta = await app.firmante.getAddress();
    usarLector(wallet, "MetaMask");
    render();
    await refrescar();
  } catch (e) {
    avisar(`No se pudo conectar: ${mensajeDeError(e)}`, "error");
  }
}

async function cambiarRed() {
  const chainId = ethers.toQuantity(app.red.chainId);
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (e) {
    if (e?.code !== 4902) throw e; // 4902: MetaMask no conoce la red
    const red = {
      chainId,
      chainName: app.red.nombre,
      rpcUrls: [app.red.rpc],
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    };
    if (app.red.explorador) red.blockExplorerUrls = [app.red.explorador];
    await window.ethereum.request({ method: "wallet_addEthereumChain", params: [red] });
  }
}

async function cargarContrato(texto) {
  if (!ethers.isAddress(texto)) {
    avisar("Esa no es una dirección válida (0x seguido de 40 caracteres hexadecimales).", "error");
    return;
  }
  const direccion = ethers.getAddress(texto);
  try {
    if ((await app.lector.getCode(direccion)) === "0x") {
      avisar(`No hay un contrato en ${corta(direccion)} en ${app.red.nombre}. ¿Elegiste la red correcta?`, "error");
      return;
    }
    const contrato = conectarContrato(direccion, app.lector);
    const bloqueDespliegue = Number(await contrato.bloqueDespliegue());
    Object.assign(app, {
      direccion,
      contrato,
      datos: null,
      eventos: [],
      ultimoBloque: bloqueDespliegue - 1,
      clavePanel: "",
      errorLectura: null,
    });
    guardarLocal(`cachipun:contrato:${app.claveRed}`, direccion);
    const url = new URL(location.href);
    url.searchParams.set("red", app.claveRed);
    url.searchParams.set("contrato", direccion);
    history.replaceState(null, "", url);
    $("#direccion").value = direccion;
    await refrescar();
  } catch (e) {
    avisar(`No se pudo leer el contrato: ${mensajeDeError(e)}`, "error");
  }
}

/** Lee eventos en tramos; si el RPC rechaza un rango grande, lo achica. */
async function leerEventos(contrato, desde, hasta) {
  const eventos = [];
  let paso = 10_000;
  let inicio = desde;
  while (inicio <= hasta) {
    const fin = Math.min(inicio + paso - 1, hasta);
    try {
      eventos.push(...(await contrato.queryFilter("*", inicio, fin)));
      inicio = fin + 1;
    } catch (e) {
      if (paso <= 500) throw e;
      paso = Math.floor(paso / 2);
    }
  }
  return eventos.filter((e) => e.eventName);
}

async function refrescar() {
  if (!app.contrato || app.refrescando) return;
  app.refrescando = true;
  const c = app.contrato;
  try {
    const [partida, ronda, estado, ganador, porAbandono, j1, j2, apuesta, plazoCommit, plazoReveal, pendiente, bloque] =
      await Promise.all([
        c.partida(),
        c.ronda(),
        c.estado(),
        c.ganador(),
        c.porAbandono(),
        c.jugador1(),
        c.jugador2(),
        c.apuesta(),
        c.plazoCommit(),
        c.plazoReveal(),
        app.cuenta ? c.pendientes(app.cuenta) : 0n,
        app.lector.getBlockNumber(),
      ]);
    if (c !== app.contrato) return; // se cargó otro contrato mientras tanto
    if (bloque > app.ultimoBloque) {
      app.eventos.push(...(await leerEventos(c, app.ultimoBloque + 1, bloque)));
      app.ultimoBloque = bloque;
    }
    app.datos = {
      partida,
      ronda,
      estado: Number(estado),
      ganador,
      porAbandono,
      j1: aJugador(j1),
      j2: aJugador(j2),
      apuesta,
      plazoCommit,
      plazoReveal,
      pendiente,
    };
    app.bloqueActual = bloque;
    app.errorLectura = null;
  } catch (e) {
    console.error(e);
    app.errorLectura = mensajeDeError(e);
  } finally {
    app.refrescando = false;
    render();
  }
}

// ─────────────────────────── Transacciones ───────────────────────────

async function enviar(descripcion, accion) {
  if (app.ocupado || !app.firmante) return false;
  app.ocupado = true;
  render();
  try {
    avisar(`${descripcion}: confirma la transacción en MetaMask…`);
    const tx = await accion(app.contrato.connect(app.firmante));
    avisar(`${descripcion}: transacción enviada, esperando que se mine… ${linkTx(tx.hash)}`, "info", true);
    await tx.wait();
    avisar(`${descripcion}: confirmada. ${linkTx(tx.hash)}`, "ok", true);
    return true;
  } catch (e) {
    console.error(e);
    avisar(`${descripcion}: ${mensajeDeError(e)}`, "error");
    return false;
  } finally {
    app.ocupado = false;
    render();
    refrescar();
  }
}

async function enviarCommit() {
  const d = app.datos;
  const jugada = app.jugadaElegida;
  if (!jugada) {
    avisar("Primero elige piedra, papel o tijera.", "error");
    return;
  }
  let valor = 0n;
  if (d.estado === Estado.EsperandoJugadores) {
    if (esCero(d.j1.addr)) {
      try {
        valor = ethers.parseEther(String(app.monto || "0"));
      } catch {
        avisar("El monto de la apuesta no es válido.", "error");
        return;
      }
      if (valor <= 0n) {
        avisar("La apuesta debe ser mayor que 0.", "error");
        return;
      }
    } else {
      valor = d.apuesta;
    }
  }
  const secreto = nuevoSecreto();
  const hash = calcularHash(jugada, secreto, app.cuenta);
  // Se guarda ANTES de enviar: si la transacción se confirma, el secreto ya está respaldado.
  guardarLocal(claveSecreto(d.partida, d.ronda), JSON.stringify({ jugada, secreto, hash }));
  const ok = await enviar(`Commit de la ronda ${d.ronda}`, (c) => c.commit(hash, { value: valor }));
  if (ok) app.jugadaElegida = null;
}

async function enviarReveal(manual) {
  const d = app.datos;
  const yo = miJugador();
  let jugada;
  let secreto;
  if (manual) {
    jugada = Number(app.manualJugada);
    secreto = app.manualSecreto.trim();
    if (!ethers.isHexString(secreto, 32)) {
      avisar("El secreto debe ser 0x seguido de 64 caracteres hexadecimales.", "error");
      return;
    }
  } else {
    const guardado = leerSecretoGuardado();
    if (!guardado) return;
    ({ jugada, secreto } = guardado);
  }
  if (calcularHash(jugada, secreto, app.cuenta) !== yo.hash) {
    avisar("Esa jugada y ese secreto no coinciden con tu commit: la transacción fallaría.", "error");
    return;
  }
  await enviar(`Reveal de la ronda ${d.ronda}`, (c) => c.reveal(jugada, secreto));
}

function linkInvitacion() {
  const url = new URL(location.href);
  url.search = new URLSearchParams({ red: app.claveRed, contrato: app.direccion }).toString();
  return url.toString();
}

function textoRespaldo() {
  const d = app.datos;
  const g = leerSecretoGuardado();
  return JSON.stringify(
    {
      contrato: app.direccion,
      red: app.red.nombre,
      partida: String(d.partida),
      ronda: String(d.ronda),
      cuenta: app.cuenta,
      jugada: `${g.jugada} (${NOMBRE_JUGADA[g.jugada]})`,
      secreto: g.secreto,
    },
    null,
    2
  );
}

// ─────────────────────────── Render ───────────────────────────

/** Redibuja un bloque solo si cambió su contenido (evita parpadeos y no pierde el scroll). */
function pintar(elemento, firma, html) {
  if (elemento.dataset.firma === firma) return;
  elemento.dataset.firma = firma;
  elemento.innerHTML = html();
}

const firmaDatos = () => JSON.stringify(app.datos, (_, v) => (typeof v === "bigint" ? v.toString() : v));

function render() {
  app.vencido = calcularVencido();
  renderCabecera();
  renderConexion();
  renderPartida();
  renderJugar();
  renderAcciones();
  renderRondas();
  renderEventos();
}

function renderCabecera() {
  $("#red").textContent = app.red.nombre;
  const boton = $("#btn-conectar");
  if (app.cuenta) {
    boton.textContent = corta(app.cuenta);
    boton.title = app.cuenta;
    boton.classList.add("conectado");
  } else {
    boton.classList.remove("conectado");
    boton.disabled = !window.ethereum;
    boton.textContent = window.ethereum ? "Conectar MetaMask" : "Sin MetaMask · modo espectador";
  }
}

function renderConexion() {
  const el = $("#estado-conexion");
  if (!app.contrato) {
    el.textContent = `Red ${app.red.nombre} · lectura vía ${app.fuente}. Pega la dirección del contrato para empezar.`;
  } else if (app.errorLectura) {
    el.innerHTML = `<span class="error">No se pudo leer el contrato: ${escapar(app.errorLectura)}</span>`;
  } else {
    el.innerHTML = `Contrato ${linkDireccion(app.direccion)} en ${app.red.nombre} · lectura vía ${app.fuente} · bloque ${app.bloqueActual ?? "…"}`;
  }
}

function renderPartida() {
  const firma = [firmaDatos(), app.cuenta, app.eventos.length].join("|");
  pintar($("#tarjeta-partida"), firma, htmlPartida);
  actualizarCuentaRegresiva();
}

function htmlPartida() {
  const d = app.datos;
  if (!d) return `<h2>Partida</h2><p class="vacio">Carga un contrato para ver la partida.</p>`;
  const plazo = plazoVigente();
  return `
    <div class="cabecera">
      <h2>Partida #${d.partida} <span class="ronda">· Ronda ${d.ronda}</span></h2>
      <span class="pill estado-${d.estado}">${NOMBRE_ESTADO[d.estado]}</span>
    </div>
    ${bannerFin()}
    <dl class="datos">
      <div><dt>Apuesta por jugador</dt><dd>${d.apuesta > 0n ? eth(d.apuesta) : "—"}</dd></div>
      <div><dt>Pozo</dt><dd>${d.apuesta > 0n ? eth(d.apuesta * 2n) : "—"}</dd></div>
      <div><dt>${plazo ? `Plazo de ${plazo.tipo}` : "Plazo"}</dt><dd id="cuenta-regresiva" class="mono">—</dd></div>
    </dl>
    <div class="marcador">
      ${tarjetaJugador(1, d.j1)}
      <div class="vs">vs</div>
      ${tarjetaJugador(2, d.j2)}
    </div>`;
}

function tarjetaJugador(n, j) {
  const d = app.datos;
  const vacio = esCero(j.addr);
  const soyYo = !vacio && mismo(j.addr, app.cuenta);
  const enCurso = d.estado <= Estado.Revelando;
  const pips = [0, 1].map((i) => `<span class="pip ${i < j.victorias ? "lleno" : ""}"></span>`).join("");
  const chips =
    enCurso && !vacio
      ? `<span class="chip ${j.comprometio ? "si" : ""}">${j.comprometio ? "✓" : "…"} commit</span>
         <span class="chip ${j.revelo ? "si" : ""}">${j.revelo ? "✓" : "…"} reveal</span>`
      : "";
  const revelada = j.revelo ? `<div class="jugada-revelada" title="${NOMBRE_JUGADA[j.jugada]}">${EMOJI_JUGADA[j.jugada]}</div>` : "";
  const trofeo = d.estado === Estado.Finalizado && mismo(d.ganador, j.addr) ? " 🏆" : "";
  return `
    <div class="jugador j${n} ${soyYo ? "yo" : ""}">
      <div class="etiqueta">Jugador ${n}${soyYo ? '<span class="tu">Tú</span>' : ""}${trofeo}</div>
      <div class="direccion">${vacio ? '<span class="vacio">Esperando…</span>' : linkDireccion(j.addr)}</div>
      <div class="pips" title="${j.victorias} victorias">${pips}</div>
      ${revelada}
      <div class="chips">${chips}</div>
    </div>`;
}

function bannerFin() {
  const d = app.datos;
  const pie = `<span class="pie">Para jugar otra, alguien tiene que abrir una nueva con <code>nuevaPartida()</code>.</span>`;
  if (d.estado === Estado.Finalizado) {
    const como = d.porAbandono ? " por abandono del rival" : "";
    const marcador = `Marcador final ${d.j1.victorias}-${d.j2.victorias}.`;
    const texto = mismo(d.ganador, app.cuenta)
      ? `<strong>¡Ganaste la partida #${d.partida}${como}!</strong> ${marcador} Recibiste ${eth(d.apuesta * 2n)}.`
      : `<strong>La partida #${d.partida} terminó.</strong> Ganó ${linkDireccion(d.ganador)}${como} y se llevó ${eth(d.apuesta * 2n)}. ${marcador}`;
    return `<div class="banner fin">${texto}${pie}</div>`;
  }
  if (d.estado === Estado.Cancelado) {
    const anulado = app.eventos.findLast((e) => e.eventName === "Anulado" && e.args.partida === d.partida);
    return `<div class="banner anulada">
      <strong>La partida #${d.partida} fue anulada</strong> (${escapar(anulado?.args.motivo ?? "plazo vencido")}).
      Cada jugador recuperó su apuesta.${pie}</div>`;
  }
  return "";
}

function actualizarCuentaRegresiva() {
  const el = $("#cuenta-regresiva");
  if (!el) return;
  const plazo = plazoVigente();
  if (!plazo) {
    el.textContent = "—";
    el.className = "mono";
    return;
  }
  const restante = Math.floor(plazo.hasta - Date.now() / 1000);
  el.textContent = formatoRestante(restante);
  el.className = `mono ${restante <= 0 ? "vencido" : restante < 60 ? "urgente" : ""}`;
}

function modoPanel() {
  const d = app.datos;
  if (!app.contrato || !d) return "sin-contrato";
  if (d.estado === Estado.Finalizado || d.estado === Estado.Cancelado) return "terminada";
  if (!app.cuenta) return "sin-wallet";
  const r = rol();
  if (d.estado === Estado.EsperandoJugadores) {
    if (esCero(d.j1.addr)) return "abrir";
    return r === 1 ? "esperando-rival" : "unirse";
  }
  if (!r) return "espectador";
  const yo = miJugador();
  if (d.estado === Estado.Comprometiendo) return yo.comprometio ? "esperando-commit" : "commit";
  return yo.revelo ? "esperando-reveal" : "reveal";
}

const TITULO_PANEL = {
  "sin-contrato": "Jugar",
  "sin-wallet": "Jugar",
  abrir: "Abrir una partida",
  unirse: "Unirse a la partida",
  "esperando-rival": "Esperando rival",
  commit: "Tu jugada",
  "esperando-commit": "Tu jugada",
  reveal: "Revelar tu jugada",
  "esperando-reveal": "Revelar tu jugada",
  espectador: "Partida en curso",
  terminada: "Partida terminada",
};

/** El panel solo se redibuja cuando cambia su situación, para no borrar lo que se está escribiendo. */
function renderJugar() {
  const d = app.datos;
  const modo = modoPanel();
  const clave = [modo, d?.partida, d?.ronda, app.cuenta, app.vencido, app.ocupado].join("|");
  if (clave === app.clavePanel) return;
  app.clavePanel = clave;
  $("#tarjeta-jugar").innerHTML = `<h2>${TITULO_PANEL[modo]}</h2>${cuerpoPanel(modo)}`;
}

function selectorJugada() {
  const opciones = [Jugada.Piedra, Jugada.Papel, Jugada.Tijera].map(
    (j) => `<button type="button" class="opcion" data-jugada="${j}" aria-pressed="${app.jugadaElegida === j}">
        <span class="emoji">${EMOJI_JUGADA[j]}</span><span>${NOMBRE_JUGADA[j]}</span></button>`
  );
  return `<div class="selector" role="group" aria-label="Elige tu jugada">${opciones.join("")}</div>`;
}

const NOTA_SECRETO = `<p class="nota">El secreto de 32 bytes se genera en tu navegador y el hash se calcula aquí mismo:
  tu jugada no viaja a la blockchain hasta que la revelas.</p>`;

function respaldo() {
  const g = leerSecretoGuardado();
  if (!g) return "";
  return `<div class="respaldo">
    <div><span class="emoji">${EMOJI_JUGADA[g.jugada]}</span> Tu jugada: <strong>${NOMBRE_JUGADA[g.jugada]}</strong></div>
    <p class="nota">Secreto <span class="mono">${g.secreto.slice(0, 10)}…${g.secreto.slice(-6)}</span> guardado en este
      navegador. Sin él no puedes revelar: copia el respaldo si vas a cambiar de equipo.</p>
    <button class="btn secundario chico" data-accion="copiar-respaldo">Copiar respaldo</button>
  </div>`;
}

function cuerpoPanel(modo) {
  const d = app.datos;
  const bloqueo = app.ocupado || app.vencido ? "disabled" : "";
  const alertaPlazo = app.vencido
    ? `<p class="alerta">El plazo de esta fase venció. Ya no se puede jugar esta ronda: usa “Reclamar timeout”.</p>`
    : "";
  switch (modo) {
    case "sin-contrato":
      return `<p class="vacio">Elige la red, pega la dirección del contrato desplegado y presiona “Cargar”.</p>`;
    case "sin-wallet":
      return `<p>Estás en modo espectador: ves la partida en vivo, pero para jugar necesitas tu wallet.</p>
        <button class="btn grande" data-accion="conectar" ${window.ethereum ? "" : "disabled"}>Conectar MetaMask para jugar</button>`;
    case "abrir":
      return `<p>No hay nadie jugando. Elige tu jugada y la apuesta para abrir la partida #${d.partida}.</p>
        ${selectorJugada()}
        <label class="campo">Apuesta (ETH)
          <input id="monto" type="number" min="0" step="0.001" inputmode="decimal" value="${escapar(app.monto)}">
        </label>
        <button class="btn grande" data-accion="commit" ${bloqueo}>Apostar y enviar commit</button>
        ${NOTA_SECRETO}`;
    case "unirse":
      return `<p>${linkDireccion(d.j1.addr)} apostó <strong>${eth(d.apuesta)}</strong>. Iguala la apuesta para jugar al mejor de tres.</p>
        ${alertaPlazo}${selectorJugada()}
        <button class="btn grande" data-accion="commit" ${bloqueo}>Igualar ${eth(d.apuesta)} y enviar commit</button>
        ${NOTA_SECRETO}`;
    case "esperando-rival":
      return `<p>Abriste la partida. Esperando que alguien iguale tu apuesta de <strong>${eth(d.apuesta)}</strong>.</p>
        ${alertaPlazo}${respaldo()}
        <button class="btn secundario" data-accion="copiar-link">Copiar link para invitar</button>`;
    case "commit":
      return `<p>Ronda ${d.ronda}: elige tu jugada. Esta vez no se envía Ether: la apuesta ya está en el pozo.</p>
        ${alertaPlazo}${selectorJugada()}
        <button class="btn grande" data-accion="commit" ${bloqueo}>Enviar commit</button>
        ${NOTA_SECRETO}`;
    case "esperando-commit":
      return `<p>Tu commit de la ronda ${d.ronda} quedó registrado. Esperando el del rival.</p>${alertaPlazo}${respaldo()}`;
    case "reveal":
      return panelReveal(bloqueo, alertaPlazo);
    case "esperando-reveal":
      return `<p>Revelaste tu jugada. Cuando el rival revele, el contrato resuelve la ronda solo.</p>${alertaPlazo}`;
    case "espectador":
      return `<p>Partida en curso entre ${linkDireccion(d.j1.addr)} y ${linkDireccion(d.j2.addr)}.
        Tu cuenta no participa: estás mirando.</p>`;
    case "terminada":
      return `<p>${d.estado === Estado.Finalizado ? "La partida terminó." : "La partida fue anulada."}
        Para jugar otra hay que abrir una nueva de forma explícita. Cualquiera puede hacerlo.</p>
        <button class="btn grande" data-accion="nueva" ${app.cuenta && !app.ocupado ? "" : "disabled"}>Abrir la partida #${d.partida + 1n}</button>`;
    default:
      return "";
  }
}

function panelReveal(bloqueo, alertaPlazo) {
  const d = app.datos;
  const guardado = leerSecretoGuardado();
  const opciones = [Jugada.Piedra, Jugada.Papel, Jugada.Tijera]
    .map((j) => `<option value="${j}" ${Number(app.manualJugada) === j ? "selected" : ""}>${jugadaTexto(j)}</option>`)
    .join("");
  const manual = `
    <details class="manual" ${guardado ? "" : "open"}>
      <summary>Revelar con un respaldo (otro navegador o Remix)</summary>
      <label class="campo">Jugada <select id="manual-jugada">${opciones}</select></label>
      <label class="campo">Secreto (bytes32)
        <input id="manual-secreto" class="mono" placeholder="0x…" spellcheck="false" autocomplete="off" value="${escapar(app.manualSecreto)}">
      </label>
      <button class="btn secundario chico" data-accion="reveal-manual" ${bloqueo}>Revelar con estos datos</button>
    </details>`;
  if (!guardado) {
    return `<p>Ronda ${d.ronda}: ambos se comprometieron. No encontré tu secreto en este navegador; ingrésalo desde tu respaldo.</p>
      ${alertaPlazo}${manual}`;
  }
  return `<p>Ronda ${d.ronda}: ambos se comprometieron. Revela antes de que venza el plazo o pierdes la partida.</p>
    ${alertaPlazo}
    <div class="tu-jugada"><span class="emoji">${EMOJI_JUGADA[guardado.jugada]}</span> ${NOMBRE_JUGADA[guardado.jugada]}</div>
    <button class="btn grande" data-accion="reveal" ${bloqueo}>Revelar jugada</button>
    ${manual}`;
}

function explicarReclamo() {
  const d = app.datos;
  const plazo = plazoVigente();
  if (!plazo) return "No hay plazos corriendo.";
  if (!app.vencido) {
    return `Se habilita cuando vence el plazo de ${plazo.tipo}. Cualquiera puede llamarla: el dinero siempre va a los jugadores.`;
  }
  if (d.estado === Estado.EsperandoJugadores) return "Nadie igualó la apuesta: la partida se anula y J1 recupera su apuesta.";
  const commit = d.estado === Estado.Comprometiendo;
  const [c1, c2] = commit ? [d.j1.comprometio, d.j2.comprometio] : [d.j1.revelo, d.j2.revelo];
  const accion = commit ? "hizo commit" : "reveló";
  if (c1 && !c2) return `J2 no ${accion} a tiempo: J1 gana la partida por abandono.`;
  if (c2 && !c1) return `J1 no ${accion} a tiempo: J2 gana la partida por abandono.`;
  return `Nadie ${accion} a tiempo: la partida se anula y ambos recuperan su apuesta.`;
}

function renderAcciones() {
  const cont = $("#tarjeta-acciones");
  cont.hidden = !app.datos;
  if (!app.datos) return;
  pintar(cont, [firmaDatos(), app.vencido, app.ocupado, app.cuenta].join("|"), htmlAcciones);
}

function htmlAcciones() {
  const d = app.datos;
  const puedeReclamar = app.vencido && app.cuenta && !app.ocupado;
  return `
    <h2>Acciones</h2>
    <div class="accion">
      <button class="btn secundario" data-accion="reclamar" ${puedeReclamar ? "" : "disabled"}>Reclamar timeout</button>
      <p class="nota">${explicarReclamo()}</p>
    </div>
    ${
      d.pendiente > 0n
        ? `<div class="accion">
            <button class="btn" data-accion="retirar" ${app.ocupado ? "disabled" : ""}>Retirar ${eth(d.pendiente)}</button>
            <p class="nota">Un pago que no se pudo entregar automáticamente quedó guardado para ti.</p>
          </div>`
        : ""
    }`;
}

function rondasDePartida(d) {
  const rondas = new Map();
  for (const e of app.eventos) {
    if (!["Reveal", "RondaGanada", "Empate"].includes(e.eventName) || e.args.partida !== d.partida) continue;
    const n = Number(e.args.ronda);
    const fila = rondas.get(n) ?? { j1: null, j2: null, resultado: null };
    if (e.eventName === "Reveal") {
      fila[mismo(e.args.jugador, d.j1.addr) ? "j1" : "j2"] = Number(e.args.jugada);
    } else if (e.eventName === "Empate") {
      fila.resultado = `<span class="nota">Empate · se repite</span>`;
    } else {
      const gana = mismo(e.args.ganador, d.j1.addr) ? 1 : 2;
      fila.resultado = `<span class="gana-j${gana}">Gana J${gana}</span>`;
    }
    rondas.set(n, fila);
  }
  return [...rondas.entries()].sort((a, b) => a[0] - b[0]);
}

function renderRondas() {
  pintar($("#tarjeta-rondas"), [firmaDatos(), app.eventos.length].join("|"), htmlRondas);
}

function htmlRondas() {
  const d = app.datos;
  if (!d) return `<h2>Rondas</h2><p class="vacio">Sin partida cargada.</p>`;
  const filas = rondasDePartida(d);
  const cuerpo = filas.length
    ? filas
        .map(
          ([n, f]) =>
            `<tr><td>${n}</td><td>${jugadaTexto(f.j1)}</td><td>${jugadaTexto(f.j2)}</td><td>${f.resultado ?? '<span class="nota">en juego</span>'}</td></tr>`
        )
        .join("")
    : `<tr><td colspan="4" class="vacio">Todavía no hay jugadas reveladas.</td></tr>`;
  return `
    <h2>Rondas de la partida #${d.partida}</h2>
    <table class="tabla">
      <thead><tr><th>Ronda</th><th>J1</th><th>J2</th><th>Resultado</th></tr></thead>
      <tbody>${cuerpo}</tbody>
    </table>
    <p class="nota">Gana la partida quien llegue primero a 2 victorias. Los empates se repiten.</p>`;
}

function detalleEvento(e) {
  const a = e.args;
  switch (e.eventName) {
    case "NuevaPartida":
      return `Se abre la partida #${a.partida}`;
    case "Commit":
      return `${linkDireccion(a.jugador)} envió su hash <span class="mono">${a.hash.slice(0, 10)}…</span>${a.monto > 0n ? ` y apostó ${eth(a.monto)}` : ""}`;
    case "Reveal":
      return `${linkDireccion(a.jugador)} reveló ${jugadaTexto(Number(a.jugada))}`;
    case "RondaGanada":
      return `Ronda para ${linkDireccion(a.ganador)} · marcador ${a.victorias1}-${a.victorias2}`;
    case "Empate":
      return "Empate: la ronda se repite";
    case "Ganador":
      return `${linkDireccion(a.ganador)} ganó la partida y recibió ${eth(a.premio)}${a.porAbandono ? " (por abandono)" : ""}`;
    case "Anulado":
      return `Partida anulada: ${escapar(a.motivo)}`;
    case "PagoPendiente":
      return `No se pudo pagar a ${linkDireccion(a.destinatario)}: ${eth(a.monto)} quedan para retirar`;
    case "Retiro":
      return `${linkDireccion(a.destinatario)} retiró ${eth(a.monto)}`;
    default:
      return "";
  }
}

function metaEvento(e) {
  const tiene = (nombre) => e.fragment.inputs.some((i) => i.name === nombre);
  if (!tiene("partida")) return "";
  return tiene("ronda") ? `partida ${e.args.partida} · ronda ${e.args.ronda}` : `partida ${e.args.partida}`;
}

function renderEventos() {
  pintar($("#lista-eventos"), `${app.direccion}|${app.eventos.length}`, htmlEventos);
}

function htmlEventos() {
  if (!app.contrato) return `<li class="vacio">Carga un contrato para ver sus eventos.</li>`;
  const ultimos = app.eventos.slice(-80).reverse();
  if (!ultimos.length) return `<li class="vacio">Sin eventos todavía.</li>`;
  return ultimos
    .map(
      (e) => `<li class="evento ev-${e.eventName}">
        <div class="ev-cabecera"><span class="ev-nombre">${e.eventName}</span><span class="ev-meta">${metaEvento(e)}</span></div>
        <div class="ev-detalle">${detalleEvento(e)}</div>
        <div class="ev-pie">bloque ${e.blockNumber} · ${linkTx(e.transactionHash)}</div>
      </li>`
    )
    .join("");
}

// ─────────────────────────── Eventos de la página ───────────────────────────

function manejarClick(ev) {
  const opcion = ev.target.closest("[data-jugada]");
  if (opcion) {
    app.jugadaElegida = Number(opcion.dataset.jugada);
    document
      .querySelectorAll("[data-jugada]")
      .forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.jugada) === app.jugadaElegida)));
    return;
  }
  const boton = ev.target.closest("[data-accion]");
  if (!boton || boton.disabled) return;
  const acciones = {
    conectar: () => conectarWallet(true),
    commit: enviarCommit,
    reveal: () => enviarReveal(false),
    "reveal-manual": () => enviarReveal(true),
    reclamar: () => enviar("Reclamar timeout", (c) => c.reclamarTimeout()),
    nueva: () => enviar("Nueva partida", (c) => c.nuevaPartida()),
    retirar: () => enviar("Retiro", (c) => c.retirar()),
    "copiar-link": () => copiar(linkInvitacion(), "Link copiado: compártelo con tu rival."),
    "copiar-respaldo": () => copiar(textoRespaldo(), "Respaldo copiado. Guárdalo hasta revelar."),
  };
  acciones[boton.dataset.accion]?.();
}

function manejarInput(ev) {
  if (ev.target.id === "monto") app.monto = ev.target.value;
  if (ev.target.id === "manual-jugada") app.manualJugada = ev.target.value;
  if (ev.target.id === "manual-secreto") app.manualSecreto = ev.target.value;
}

/** Cada segundo: cuenta regresiva y, si venció un plazo, redibuja. */
function tic() {
  actualizarCuentaRegresiva();
  if (calcularVencido() !== app.vencido) render();
}

async function iniciar() {
  const params = new URLSearchParams(location.search);
  app.claveRed = params.get("red") === "local" ? "local" : "sepolia";
  app.red = REDES[app.claveRed];
  app.rpc = new ethers.JsonRpcProvider(app.red.rpc, Number(app.red.chainId), { staticNetwork: true });
  usarLector(app.rpc, app.red.fuente);
  $("#selector-red").value = app.claveRed;

  const direccion = params.get("contrato") || leerLocal(`cachipun:contrato:${app.claveRed}`);
  if (direccion) $("#direccion").value = direccion;

  $("#form-contrato").addEventListener("submit", (ev) => {
    ev.preventDefault();
    cargarContrato($("#direccion").value.trim());
  });
  $("#selector-red").addEventListener("change", (ev) => {
    const url = new URL(location.href);
    url.search = new URLSearchParams({ red: ev.target.value }).toString();
    location.href = url.toString();
  });
  $("#btn-conectar").addEventListener("click", () => conectarWallet(true));
  document.addEventListener("click", manejarClick);
  document.addEventListener("input", manejarInput);

  render();
  if (window.ethereum) {
    window.ethereum.on?.("chainChanged", () => location.reload());
    window.ethereum.on?.("accountsChanged", () => conectarWallet(false));
    await conectarWallet(false);
  }
  if (direccion) await cargarContrato(direccion);

  setInterval(refrescar, INTERVALO_MS);
  setInterval(tic, 1000);
}

iniciar();
