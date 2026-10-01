const { expect } = require("chai");
const { ethers, artifacts } = require("hardhat");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// Estos tests usan el mismo módulo que carga el navegador (dapp/contrato.js),
// para asegurar que la DApp y el contrato compilado hablan el mismo idioma.
describe("DApp (dapp/contrato.js)", function () {
  let dapp;

  before(async function () {
    dapp = await import(pathToFileURL(path.join(__dirname, "..", "dapp", "contrato.js")).href);
  });

  it("calcularHash da lo mismo que generarHash del contrato", async function () {
    const [j1] = await ethers.getSigners();
    const juego = await ethers.deployContract("Cachipun", [300, 300]);
    for (const jugada of [dapp.Jugada.Piedra, dapp.Jugada.Papel, dapp.Jugada.Tijera]) {
      const secreto = dapp.nuevoSecreto();
      expect(dapp.calcularHash(jugada, secreto, j1.address)).to.equal(
        await juego.generarHash(jugada, secreto, j1.address)
      );
    }
  });

  it("cada función y evento del ABI de la DApp existe igual en el contrato compilado", async function () {
    const compilado = new ethers.Interface((await artifacts.readArtifact("Cachipun")).abi);
    const deLaDapp = new ethers.Interface(dapp.ABI);
    const salidas = (f) => f.outputs.map((p) => `${p.type} ${p.name}`);

    deLaDapp.forEachFunction((f) => {
      const real = compilado.getFunction(f.selector);
      expect(real, f.format()).to.not.equal(null);
      expect(f.stateMutability, f.format()).to.equal(real.stateMutability);
      expect(salidas(f), f.format()).to.deep.equal(salidas(real));
    });
    deLaDapp.forEachEvent((e) => {
      const real = compilado.getEvent(e.topicHash);
      expect(real, e.format()).to.not.equal(null);
      expect(e.format("full")).to.equal(real.format("full"));
    });
  });

  it("con el ABI de la DApp se juega una partida completa y se leen sus eventos", async function () {
    const [j1, j2] = await ethers.getSigners();
    const desplegado = await ethers.deployContract("Cachipun", [300, 300]);
    const juego = dapp.conectarContrato(await desplegado.getAddress(), ethers.provider);
    const apuesta = ethers.parseEther("0.01");

    // J1 gana 2-0 jugando Papel contra Piedra.
    for (const valor of [apuesta, 0n]) {
      const s1 = dapp.nuevoSecreto();
      const s2 = dapp.nuevoSecreto();
      await juego.connect(j1).commit(dapp.calcularHash(dapp.Jugada.Papel, s1, j1.address), { value: valor });
      await juego.connect(j2).commit(dapp.calcularHash(dapp.Jugada.Piedra, s2, j2.address), { value: valor });
      await juego.connect(j1).reveal(dapp.Jugada.Papel, s1);
      await juego.connect(j2).reveal(dapp.Jugada.Piedra, s2);
    }

    expect(await juego.estado()).to.equal(dapp.Estado.Finalizado);
    expect(await juego.ganador()).to.equal(j1.address);
    expect((await juego.jugador1()).victorias).to.equal(2);

    const eventos = await juego.queryFilter("*", await juego.bloqueDespliegue());
    expect(eventos.map((e) => e.eventName)).to.deep.equal([
      "NuevaPartida",
      "Commit", "Commit", "Reveal", "Reveal", "RondaGanada",
      "Commit", "Commit", "Reveal", "Reveal", "RondaGanada", "Ganador",
    ]);
    const ganador = eventos.at(-1);
    expect(ganador.args.ganador).to.equal(j1.address);
    expect(ganador.args.premio).to.equal(apuesta * 2n);
  });
});
