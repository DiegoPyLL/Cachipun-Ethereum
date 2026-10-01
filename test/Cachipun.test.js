const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const Jugada = { Ninguna: 0, Piedra: 1, Papel: 2, Tijera: 3 };
const Estado = { EsperandoJugadores: 0, Comprometiendo: 1, Revelando: 2, Finalizado: 3, Cancelado: 4 };
const Modo = { Acepta: 0, Rechaza: 1, ConsumeGas: 2, Reentra: 3 };
const NOMBRE = ["Ninguna", "Piedra", "Papel", "Tijera"];
// Qué jugada vence a cuál: Piedra > Tijera, Papel > Piedra, Tijera > Papel.
const VENCE_A = { [Jugada.Piedra]: Jugada.Tijera, [Jugada.Papel]: Jugada.Piedra, [Jugada.Tijera]: Jugada.Papel };

const APUESTA = ethers.parseEther("0.01");
const POZO = APUESTA * 2n;
const DURACION = 300; // 5 minutos por fase

const nuevoSecreto = () => ethers.hexlify(ethers.randomBytes(32));
const hashDe = (jugada, secreto, direccion) =>
  ethers.solidityPackedKeccak256(["uint8", "bytes32", "address"], [jugada, secreto, direccion]);

async function desplegar() {
  const [j1, j2, tercero] = await ethers.getSigners();
  const juego = await ethers.deployContract("Cachipun", [DURACION, DURACION]);
  return { juego, j1, j2, tercero };
}

async function desplegarConMalicioso() {
  const base = await desplegar();
  const malicioso = await ethers.deployContract("JugadorMalicioso", [base.juego]);
  return { ...base, malicioso };
}

/** Hace commit de una jugada con un secreto nuevo y devuelve lo necesario para revelar. */
async function comprometer(juego, jugador, jugada, valor = 0n) {
  const secreto = nuevoSecreto();
  await juego.connect(jugador).commit(hashDe(jugada, secreto, jugador.address), { value: valor });
  return { jugada, secreto };
}

/** Juega una ronda completa y devuelve la tx del último reveal (la que resuelve). */
async function jugarRonda(juego, j1, j2, jugada1, jugada2, valor = 0n) {
  const c1 = await comprometer(juego, j1, jugada1, valor);
  const c2 = await comprometer(juego, j2, jugada2, valor);
  await juego.connect(j1).reveal(c1.jugada, c1.secreto);
  return juego.connect(j2).reveal(c2.jugada, c2.secreto);
}

describe("Cachipun", function () {
  describe("Despliegue", function () {
    it("parte en la partida 1, ronda 1, esperando jugadores", async function () {
      const { juego } = await loadFixture(desplegar);
      expect(await juego.partida()).to.equal(1);
      expect(await juego.ronda()).to.equal(1);
      expect(await juego.estado()).to.equal(Estado.EsperandoJugadores);
      expect(await juego.duracionCommit()).to.equal(DURACION);
      expect(await juego.duracionReveal()).to.equal(DURACION);
      expect(await juego.bloqueDespliegue()).to.equal(
        (await juego.deploymentTransaction().wait()).blockNumber
      );
      await expect(juego.deploymentTransaction()).to.emit(juego, "NuevaPartida").withArgs(1);
    });

    it("rechaza plazos menores a 1 minuto", async function () {
      const fabrica = await ethers.getContractFactory("Cachipun");
      await expect(fabrica.deploy(59, DURACION)).to.be.revertedWith("Plazo minimo: 1 minuto");
      await expect(fabrica.deploy(DURACION, 59)).to.be.revertedWith("Plazo minimo: 1 minuto");
    });

    it("rechaza Ether enviado directo al contrato", async function () {
      const { juego, j1 } = await loadFixture(desplegar);
      await expect(j1.sendTransaction({ to: juego, value: APUESTA })).to.be.reverted;
    });
  });

  describe("generarHash", function () {
    it("coincide con el hash que calcula la DApp (solidityPackedKeccak256)", async function () {
      const { juego, j1 } = await loadFixture(desplegar);
      const secreto = nuevoSecreto();
      for (const jugada of [Jugada.Piedra, Jugada.Papel, Jugada.Tijera]) {
        expect(await juego.generarHash(jugada, secreto, j1.address)).to.equal(hashDe(jugada, secreto, j1.address));
      }
    });

    it("cambia con la dirección: nadie puede copiar el hash de otro", async function () {
      const { juego, j1, j2 } = await loadFixture(desplegar);
      const secreto = nuevoSecreto();
      expect(await juego.generarHash(Jugada.Piedra, secreto, j1.address)).to.not.equal(
        await juego.generarHash(Jugada.Piedra, secreto, j2.address)
      );
    });
  });

  describe("Ronda 1: registro con apuesta", function () {
    it("J1 abre la partida con su apuesta", async function () {
      const { juego, j1 } = await loadFixture(desplegar);
      const secreto = nuevoSecreto();
      const hash = hashDe(Jugada.Piedra, secreto, j1.address);

      const tx = juego.connect(j1).commit(hash, { value: APUESTA });
      await expect(tx).to.emit(juego, "Commit").withArgs(1, 1, j1.address, hash, APUESTA);
      await expect(tx).to.changeEtherBalances([j1, juego], [-APUESTA, APUESTA]);

      const jugador1 = await juego.jugador1();
      expect(jugador1.addr).to.equal(j1.address);
      expect(jugador1.hash).to.equal(hash);
      expect(jugador1.comprometio).to.equal(true);
      expect(await juego.apuesta()).to.equal(APUESTA);
      expect(await juego.plazoCommit()).to.equal((await time.latest()) + DURACION);
      expect(await juego.estado()).to.equal(Estado.EsperandoJugadores);
    });

    it("rechaza abrir sin apuesta o con hash vacío", async function () {
      const { juego, j1 } = await loadFixture(desplegar);
      const hash = hashDe(Jugada.Piedra, nuevoSecreto(), j1.address);
      await expect(juego.connect(j1).commit(hash)).to.be.revertedWith("Debes apostar ETH");
      await expect(juego.connect(j1).commit(ethers.ZeroHash, { value: APUESTA })).to.be.revertedWith("Hash vacio");
    });

    it("J2 debe igualar exactamente la apuesta", async function () {
      const { juego, j1, j2 } = await loadFixture(desplegar);
      await comprometer(juego, j1, Jugada.Piedra, APUESTA);
      const hash = hashDe(Jugada.Papel, nuevoSecreto(), j2.address);
      await expect(juego.connect(j2).commit(hash, { value: APUESTA - 1n })).to.be.revertedWith(
        "Debes igualar la apuesta"
      );
      await expect(juego.connect(j2).commit(hash, { value: APUESTA + 1n })).to.be.revertedWith(
        "Debes igualar la apuesta"
      );
    });

    it("J1 no puede ser también J2", async function () {
      const { juego, j1 } = await loadFixture(desplegar);
      await comprometer(juego, j1, Jugada.Piedra, APUESTA);
      await expect(comprometer(juego, j1, Jugada.Papel, APUESTA)).to.be.revertedWith("Ya estas en la partida");
    });

    it("J2 puede entrar justo en el límite del plazo, pero no después", async function () {
      const { juego, j1, j2, tercero } = await loadFixture(desplegar);
      await comprometer(juego, j1, Jugada.Piedra, APUESTA);
      const plazo = await juego.plazoCommit();

      const snapshot = await ethers.provider.send("evm_snapshot");
      await time.setNextBlockTimestamp(plazo);
      await comprometer(juego, j2, Jugada.Papel, APUESTA); // en el límite: válido
      await ethers.provider.send("evm_revert", [snapshot]);

      await time.setNextBlockTimestamp(plazo + 1n);
      await expect(comprometer(juego, tercero, Jugada.Papel, APUESTA)).to.be.revertedWith(
        "Plazo de commit vencido"
      );
    });

    it("con J2 adentro empieza la fase de reveal", async function () {
      const { juego, j1, j2 } = await loadFixture(desplegar);
      await comprometer(juego, j1, Jugada.Piedra, APUESTA);
      await comprometer(juego, j2, Jugada.Papel, APUESTA);

      expect(await juego.estado()).to.equal(Estado.Revelando);
      expect(await juego.plazoReveal()).to.equal((await time.latest()) + DURACION);
      expect((await juego.jugador2()).addr).to.equal(j2.address);
      expect(await ethers.provider.getBalance(juego)).to.equal(POZO);
    });

    it("un tercero no puede entrar a una partida en curso", async function () {
      const { juego, j1, j2, tercero } = await loadFixture(desplegar);
      await comprometer(juego, j1, Jugada.Piedra, APUESTA);
      await comprometer(juego, j2, Jugada.Papel, APUESTA);
      await expect(comprometer(juego, tercero, Jugada.Tijera, APUESTA)).to.be.revertedWith(
        "Ronda en fase de reveal"
      );
    });
  });

  describe("Reveal", function () {
    async function ambosComprometidos() {
      const base = await desplegar();
      const c1 = await comprometer(base.juego, base.j1, Jugada.Piedra, APUESTA);
      const c2 = await comprometer(base.juego, base.j2, Jugada.Tijera, APUESTA);
      return { ...base, c1, c2 };
    }

    it("no se puede revelar antes de que ambos apuesten", async function () {
      const { juego, j1 } = await loadFixture(desplegar);
      const c1 = await comprometer(juego, j1, Jugada.Piedra, APUESTA);
      await expect(juego.connect(j1).reveal(c1.jugada, c1.secreto)).to.be.revertedWith("No es fase de reveal");
    });

    it("publica la jugada con el número de partida y ronda", async function () {
      const { juego, j1, c1 } = await loadFixture(ambosComprometidos);
      await expect(juego.connect(j1).reveal(c1.jugada, c1.secreto))
        .to.emit(juego, "Reveal")
        .withArgs(1, 1, j1.address, Jugada.Piedra);
      const jugador1 = await juego.jugador1();
      expect(jugador1.revelo).to.equal(true);
      expect(jugador1.jugada).to.equal(Jugada.Piedra);
    });

    it("rechaza a quien no es jugador", async function () {
      const { juego, tercero, c1 } = await loadFixture(ambosComprometidos);
      await expect(juego.connect(tercero).reveal(c1.jugada, c1.secreto)).to.be.revertedWith(
        "No eres jugador de esta partida"
      );
    });

    it("rechaza una jugada o un secreto que no coinciden con el commit", async function () {
      const { juego, j1, c1 } = await loadFixture(ambosComprometidos);
      await expect(juego.connect(j1).reveal(Jugada.Papel, c1.secreto)).to.be.revertedWith(
        "No coincide con tu commit"
      );
      await expect(juego.connect(j1).reveal(c1.jugada, nuevoSecreto())).to.be.revertedWith(
        "No coincide con tu commit"
      );
    });

    it("rechaza el secreto de otro jugador (la dirección va en el hash)", async function () {
      const { juego, j1, c2 } = await loadFixture(ambosComprometidos);
      await expect(juego.connect(j1).reveal(c2.jugada, c2.secreto)).to.be.revertedWith(
        "No coincide con tu commit"
      );
    });

    it("rechaza jugadas inválidas", async function () {
      const { juego, j1, c1 } = await loadFixture(ambosComprometidos);
      await expect(juego.connect(j1).reveal(Jugada.Ninguna, c1.secreto)).to.be.revertedWith("Jugada invalida");
      await expect(juego.connect(j1).reveal(4, c1.secreto)).to.be.reverted; // fuera del enum
    });

    it("no se puede revelar dos veces", async function () {
      const { juego, j1, c1 } = await loadFixture(ambosComprometidos);
      await juego.connect(j1).reveal(c1.jugada, c1.secreto);
      await expect(juego.connect(j1).reveal(c1.jugada, c1.secreto)).to.be.revertedWith("Ya revelaste");
    });

    it("se puede revelar justo en el límite del plazo, pero no después", async function () {
      const { juego, j1, j2, c1, c2 } = await loadFixture(ambosComprometidos);
      const plazo = await juego.plazoReveal();
      await time.setNextBlockTimestamp(plazo);
      await juego.connect(j1).reveal(c1.jugada, c1.secreto); // en el límite: válido
      await expect(juego.connect(j2).reveal(c2.jugada, c2.secreto)).to.be.revertedWith("Plazo de reveal vencido");
    });
  });

  describe("Lógica del ganador (9 combinaciones)", function () {
    const jugadas = [Jugada.Piedra, Jugada.Papel, Jugada.Tijera];
    for (const a of jugadas) {
      for (const b of jugadas) {
        const esperado = a === b ? "empate" : VENCE_A[a] === b ? "gana J1" : "gana J2";
        it(`${NOMBRE[a]} vs ${NOMBRE[b]}: ${esperado}`, async function () {
          const { juego, j1, j2 } = await loadFixture(desplegar);
          const tx = await jugarRonda(juego, j1, j2, a, b, APUESTA);

          if (esperado === "empate") {
            await expect(tx).to.emit(juego, "Empate").withArgs(1, 1);
          } else {
            const ganadorRonda = esperado === "gana J1" ? j1 : j2;
            const marcador = esperado === "gana J1" ? [1, 0] : [0, 1];
            await expect(tx)
              .to.emit(juego, "RondaGanada")
              .withArgs(1, 1, ganadorRonda.address, ...marcador);
          }
          // Con 1 victoria nadie gana todavía: siempre se pasa a la ronda 2.
          expect(await juego.ronda()).to.equal(2);
          expect(await juego.estado()).to.equal(Estado.Comprometiendo);
        });
      }
    }
  });

  describe("Partida al mejor de tres", function () {
    it("2-0: el ganador recibe el pozo completo", async function () {
      const { juego, j1, j2 } = await loadFixture(desplegar);
      await jugarRonda(juego, j1, j2, Jugada.Papel, Jugada.Piedra, APUESTA);
      const tx = await jugarRonda(juego, j1, j2, Jugada.Tijera, Jugada.Papel);

      await expect(tx).to.changeEtherBalances([j1, j2, juego], [POZO, 0, -POZO]);
      await expect(tx).to.emit(juego, "Ganador").withArgs(1, j1.address, POZO, false);
      expect(await juego.estado()).to.equal(Estado.Finalizado);
      expect(await juego.ganador()).to.equal(j1.address);
      expect(await juego.porAbandono()).to.equal(false);
      expect((await juego.jugador1()).victorias).to.equal(2);
      expect((await juego.jugador2()).victorias).to.equal(0);
    });

    it("2-1: se juegan tres rondas", async function () {
      const { juego, j1, j2 } = await loadFixture(desplegar);
      const r1 = await jugarRonda(juego, j1, j2, Jugada.Piedra, Jugada.Papel, APUESTA);
      await expect(r1).to.emit(juego, "RondaGanada").withArgs(1, 1, j2.address, 0, 1);
      const r2 = await jugarRonda(juego, j1, j2, Jugada.Piedra, Jugada.Tijera);
      await expect(r2).to.emit(juego, "RondaGanada").withArgs(1, 2, j1.address, 1, 1);
      const r3 = await jugarRonda(juego, j1, j2, Jugada.Papel, Jugada.Piedra);
      await expect(r3).to.emit(juego, "RondaGanada").withArgs(1, 3, j1.address, 2, 1);

      await expect(r3).to.changeEtherBalances([j1, j2], [POZO, 0]);
      expect(await juego.ganador()).to.equal(j1.address);
      expect(await juego.ronda()).to.equal(3);
    });

    it("los empates repiten la ronda y no suman victorias", async function () {
      const { juego, j1, j2 } = await loadFixture(desplegar);
      await jugarRonda(juego, j1, j2, Jugada.Piedra, Jugada.Piedra, APUESTA);
      await jugarRonda(juego, j1, j2, Jugada.Tijera, Jugada.Tijera);
      expect(await juego.ronda()).to.equal(3);
      expect((await juego.jugador1()).victorias).to.equal(0);
      expect((await juego.jugador2()).victorias).to.equal(0);

      await jugarRonda(juego, j1, j2, Jugada.Piedra, Jugada.Papel);
      const tx = await jugarRonda(juego, j1, j2, Jugada.Tijera, Jugada.Piedra);
      await expect(tx).to.changeEtherBalances([j1, j2], [0, POZO]);
      expect(await juego.ganador()).to.equal(j2.address);
      expect(await juego.ronda()).to.equal(4);
    });

    it("la ronda 2 abre el reveal cuando ambos hacen commit", async function () {
      const { juego, j1, j2 } = await loadFixture(desplegar);
      await jugarRonda(juego, j1, j2, Jugada.Papel, Jugada.Piedra, APUESTA);
      const c1 = await comprometer(juego, j1, Jugada.Piedra);
      expect(await juego.estado()).to.equal(Estado.Comprometiendo);
      const hash2 = hashDe(Jugada.Papel, nuevoSecreto(), j2.address);
      await expect(juego.connect(j2).commit(hash2)).to.emit(juego, "Commit").withArgs(1, 2, j2.address, hash2, 0);
      expect(await juego.estado()).to.equal(Estado.Revelando);
      await juego.connect(j1).reveal(c1.jugada, c1.secreto);
    });

    it("en las rondas siguientes el commit no lleva Ether ni se repite", async function () {
      const { juego, j1, j2, tercero } = await loadFixture(desplegar);
      await jugarRonda(juego, j1, j2, Jugada.Papel, Jugada.Piedra, APUESTA);
      await expect(comprometer(juego, j1, Jugada.Piedra, APUESTA)).to.be.revertedWith("La apuesta ya fue pagada");
      await comprometer(juego, j1, Jugada.Piedra);
      await expect(comprometer(juego, j1, Jugada.Papel)).to.be.revertedWith("Ya hiciste commit en esta ronda");
      await expect(comprometer(juego, tercero, Jugada.Papel)).to.be.revertedWith(
        "No eres jugador de esta partida"
      );
    });

    it("rechaza reutilizar el secreto de la ronda anterior", async function () {
      const { juego, j1, j2 } = await loadFixture(desplegar);
      const c1 = await comprometer(juego, j1, Jugada.Papel, APUESTA);
      const c2 = await comprometer(juego, j2, Jugada.Piedra, APUESTA);
      await juego.connect(j1).reveal(c1.jugada, c1.secreto);
      await juego.connect(j2).reveal(c2.jugada, c2.secreto);

      for (const jugada of [Jugada.Piedra, Jugada.Papel, Jugada.Tijera]) {
        await expect(juego.connect(j1).commit(hashDe(jugada, c1.secreto, j1.address))).to.be.revertedWith(
          "Usa un secreto nuevo"
        );
      }
      await comprometer(juego, j1, Jugada.Tijera); // con un secreto nuevo sí funciona
    });
  });

  describe("Plazos y abandono", function () {
    it("ronda 1 sin rival: se anula y J1 recupera su apuesta", async function () {
      const { juego, j1, tercero } = await loadFixture(desplegar);
      await comprometer(juego, j1, Jugada.Piedra, APUESTA);
      await expect(juego.reclamarTimeout()).to.be.revertedWith("El plazo de commit sigue vigente");

      await time.increase(DURACION + 1);
      // Cualquiera puede llamar reclamarTimeout: el dinero va a J1, no a quien llama.
      const tx = juego.connect(tercero).reclamarTimeout();
      await expect(tx).to.emit(juego, "Anulado").withArgs(1, "Nadie igualo la apuesta");
      await expect(tx).to.changeEtherBalances([j1, tercero, juego], [APUESTA, 0, -APUESTA]);
      expect(await juego.estado()).to.equal(Estado.Cancelado);
    });

    it("sin partida en curso no hay nada que reclamar", async function () {
      const { juego } = await loadFixture(desplegar);
      await expect(juego.reclamarTimeout()).to.be.revertedWith("No hay partida en curso");
    });

    it("el reclamo no procede justo en el límite del plazo de reveal", async function () {
      const { juego, j1, j2 } = await loadFixture(desplegar);
      await comprometer(juego, j1, Jugada.Piedra, APUESTA);
      await comprometer(juego, j2, Jugada.Papel, APUESTA);
      await time.setNextBlockTimestamp(await juego.plazoReveal());
      await expect(juego.reclamarTimeout()).to.be.revertedWith("El plazo de reveal sigue vigente");
    });

    it("si solo J1 revela, J2 pierde la partida", async function () {
      const { juego, j1, j2 } = await loadFixture(desplegar);
      const c1 = await comprometer(juego, j1, Jugada.Piedra, APUESTA);
      await comprometer(juego, j2, Jugada.Papel, APUESTA); // J2 iba ganando, pero no revela
      await juego.connect(j1).reveal(c1.jugada, c1.secreto);

      await time.increase(DURACION + 1);
      const tx = juego.reclamarTimeout();
      await expect(tx).to.emit(juego, "Ganador").withArgs(1, j1.address, POZO, true);
      await expect(tx).to.changeEtherBalances([j1, j2], [POZO, 0]);
      expect(await juego.porAbandono()).to.equal(true);
    });

    it("si solo J2 revela, J1 pierde la partida", async function () {
      const { juego, j1, j2 } = await loadFixture(desplegar);
      await comprometer(juego, j1, Jugada.Piedra, APUESTA);
      const c2 = await comprometer(juego, j2, Jugada.Tijera, APUESTA);
      await juego.connect(j2).reveal(c2.jugada, c2.secreto);

      await time.increase(DURACION + 1);
      await expect(juego.reclamarTimeout()).to.changeEtherBalances([j1, j2], [0, POZO]);
      expect(await juego.ganador()).to.equal(j2.address);
    });

    it("si nadie revela, la partida se anula y ambos recuperan su apuesta", async function () {
      const { juego, j1, j2 } = await loadFixture(desplegar);
      await comprometer(juego, j1, Jugada.Piedra, APUESTA);
      await comprometer(juego, j2, Jugada.Papel, APUESTA);

      await time.increase(DURACION + 1);
      const tx = juego.reclamarTimeout();
      await expect(tx).to.emit(juego, "Anulado").withArgs(1, "Nadie revelo");
      await expect(tx).to.changeEtherBalances([j1, j2, juego], [APUESTA, APUESTA, -POZO]);
      expect(await juego.estado()).to.equal(Estado.Cancelado);
    });

    it("en la ronda 2, quien no hace commit pierde aunque fuera ganando", async function () {
      const { juego, j1, j2 } = await loadFixture(desplegar);
      await jugarRonda(juego, j1, j2, Jugada.Papel, Jugada.Piedra, APUESTA); // J1 gana 1-0
      await comprometer(juego, j2, Jugada.Tijera); // J1 abandona la ronda 2
      await expect(juego.reclamarTimeout()).to.be.revertedWith("El plazo de commit sigue vigente");

      await time.increase(DURACION + 1);
      const tx = juego.reclamarTimeout();
      await expect(tx).to.emit(juego, "Ganador").withArgs(1, j2.address, POZO, true);
      await expect(tx).to.changeEtherBalances([j1, j2], [0, POZO]);
    });

    it("si nadie hace commit en la ronda 2, la partida se anula", async function () {
      const { juego, j1, j2 } = await loadFixture(desplegar);
      await jugarRonda(juego, j1, j2, Jugada.Papel, Jugada.Piedra, APUESTA);
      await time.increase(DURACION + 1);
      const tx = juego.reclamarTimeout();
      await expect(tx).to.emit(juego, "Anulado").withArgs(1, "Nadie hizo commit");
      await expect(tx).to.changeEtherBalances([j1, j2], [APUESTA, APUESTA]);
    });

    it("no se puede hacer commit en la ronda 2 después del plazo", async function () {
      const { juego, j1, j2 } = await loadFixture(desplegar);
      await jugarRonda(juego, j1, j2, Jugada.Papel, Jugada.Piedra, APUESTA);
      await time.increase(DURACION + 1);
      await expect(comprometer(juego, j1, Jugada.Piedra)).to.be.revertedWith("Plazo de commit vencido");
    });
  });

  describe("Fin explícito y nueva partida", function () {
    async function partidaTerminada() {
      const base = await desplegar();
      await jugarRonda(base.juego, base.j1, base.j2, Jugada.Papel, Jugada.Piedra, APUESTA);
      await jugarRonda(base.juego, base.j1, base.j2, Jugada.Papel, Jugada.Piedra);
      return base;
    }

    it("con la partida terminada, commit y reclamarTimeout lo dicen explícitamente", async function () {
      const { juego, j1 } = await loadFixture(partidaTerminada);
      await expect(comprometer(juego, j1, Jugada.Piedra, APUESTA)).to.be.revertedWith(
        "La partida termino: llama a nuevaPartida()"
      );
      await expect(juego.reclamarTimeout()).to.be.revertedWith("La partida ya termino");
    });

    it("el resultado queda legible en el contrato hasta nuevaPartida()", async function () {
      const { juego, j1 } = await loadFixture(partidaTerminada);
      expect(await juego.estado()).to.equal(Estado.Finalizado);
      expect(await juego.ganador()).to.equal(j1.address);
      expect((await juego.jugador1()).victorias).to.equal(2);
      expect(await juego.apuesta()).to.equal(APUESTA);
    });

    it("nuevaPartida() solo funciona con la partida terminada", async function () {
      const { juego, j1, j2 } = await loadFixture(desplegar);
      await expect(juego.nuevaPartida()).to.be.revertedWith("La partida actual no ha terminado");
      await comprometer(juego, j1, Jugada.Piedra, APUESTA);
      await comprometer(juego, j2, Jugada.Papel, APUESTA);
      await expect(juego.nuevaPartida()).to.be.revertedWith("La partida actual no ha terminado");
    });

    it("nuevaPartida() abre la partida 2 y limpia el último resultado", async function () {
      const { juego, tercero } = await loadFixture(partidaTerminada);
      await expect(juego.connect(tercero).nuevaPartida()).to.emit(juego, "NuevaPartida").withArgs(2);

      expect(await juego.partida()).to.equal(2);
      expect(await juego.ronda()).to.equal(1);
      expect(await juego.estado()).to.equal(Estado.EsperandoJugadores);
      expect(await juego.ganador()).to.equal(ethers.ZeroAddress);
      expect(await juego.apuesta()).to.equal(0);
      expect((await juego.jugador1()).addr).to.equal(ethers.ZeroAddress);
      expect((await juego.jugador1()).victorias).to.equal(0);
    });

    it("el historial de partidas anteriores queda en los eventos", async function () {
      const { juego, j1, j2 } = await loadFixture(partidaTerminada);
      await juego.nuevaPartida();
      // La revancha la gana J2.
      await jugarRonda(juego, j1, j2, Jugada.Piedra, Jugada.Papel, APUESTA);
      await jugarRonda(juego, j1, j2, Jugada.Piedra, Jugada.Papel);

      const [p1] = await juego.queryFilter(juego.filters.Ganador(1));
      const [p2] = await juego.queryFilter(juego.filters.Ganador(2));
      expect(p1.args.ganador).to.equal(j1.address);
      expect(p2.args.ganador).to.equal(j2.address);
      expect(await juego.queryFilter(juego.filters.Reveal(2))).to.have.length(4);
    });

    it("una partida anulada también exige nuevaPartida()", async function () {
      const { juego, j1 } = await loadFixture(desplegar);
      await comprometer(juego, j1, Jugada.Piedra, APUESTA);
      await time.increase(DURACION + 1);
      await juego.reclamarTimeout();
      await expect(comprometer(juego, j1, Jugada.Piedra, APUESTA)).to.be.revertedWith(
        "La partida termino: llama a nuevaPartida()"
      );
      await juego.nuevaPartida();
      await comprometer(juego, j1, Jugada.Piedra, APUESTA);
      expect(await juego.partida()).to.equal(2);
    });
  });

  describe("Seguridad en los pagos", function () {
    /** El contrato malicioso es J1 y el rival es honesto; nadie revela y se anula. */
    async function anularConMalicioso(modo) {
      const base = await desplegarConMalicioso();
      const { juego, malicioso, j2 } = base;
      await malicioso.setModo(modo);
      const direccion = await malicioso.getAddress();
      await malicioso.commit(hashDe(Jugada.Piedra, nuevoSecreto(), direccion), { value: APUESTA });
      await comprometer(juego, j2, Jugada.Papel, APUESTA);
      await time.increase(DURACION + 1);
      const tx = await juego.reclamarTimeout();
      return { ...base, tx, direccion };
    }

    it("un receptor que rechaza Ether no bloquea el reembolso del rival", async function () {
      const { juego, malicioso, j2, tx, direccion } = await anularConMalicioso(Modo.Rechaza);
      await expect(tx).to.changeEtherBalance(j2, APUESTA);
      await expect(tx).to.emit(juego, "PagoPendiente").withArgs(direccion, APUESTA);
      expect(await juego.pendientes(direccion)).to.equal(APUESTA);

      // Si retira mientras sigue rechazando Ether, la transacción revierte y el saldo se conserva.
      await expect(malicioso.retirar()).to.be.revertedWith("Transferencia fallida");
      expect(await juego.pendientes(direccion)).to.equal(APUESTA);

      // Después puede retirar su saldo cuando acepte Ether.
      await malicioso.setModo(Modo.Acepta);
      const retiro = malicioso.retirar();
      await expect(retiro).to.emit(juego, "Retiro").withArgs(direccion, APUESTA);
      await expect(retiro).to.changeEtherBalances([malicioso, juego], [APUESTA, -APUESTA]);
      expect(await juego.pendientes(direccion)).to.equal(0);
    });

    it("retirar sin saldo pendiente revierte", async function () {
      const { juego, j1 } = await loadFixture(desplegar);
      await expect(juego.connect(j1).retirar()).to.be.revertedWith("No tienes saldo pendiente");
    });

    it("un receptor que consume todo el gas tampoco bloquea al rival", async function () {
      const { juego, j2, tx, direccion } = await anularConMalicioso(Modo.ConsumeGas);
      await expect(tx).to.changeEtherBalance(j2, APUESTA);
      expect(await juego.pendientes(direccion)).to.equal(APUESTA);
    });

    it("a mitad de un pago, el ReentrancyGuard bloquea la reentrada por cualquier función", async function () {
      const { juego, malicioso, j2, tx } = await anularConMalicioso(Modo.Reentra);
      expect(await malicioso.intentosReentrada()).to.equal(1);
      // nuevaPartida, commit, reveal, reclamarTimeout y retirar: las 5 revierten por el guard.
      expect(await malicioso.reentradasBloqueadas()).to.equal(5);
      expect(await malicioso.reentradaExitosa()).to.equal(false);
      expect(await juego.estado()).to.equal(Estado.Cancelado);
      expect(await juego.partida()).to.equal(1);
      await expect(tx).to.changeEtherBalances([malicioso, j2], [APUESTA, APUESTA]);
    });

    it("un contrato puede jugar y cobrar el premio normalmente", async function () {
      const { juego, malicioso, j2 } = await loadFixture(desplegarConMalicioso);
      const direccion = await malicioso.getAddress();
      for (const [ronda, valor] of [[1, APUESTA], [2, 0n]]) {
        const secreto = nuevoSecreto();
        await malicioso.commit(hashDe(Jugada.Papel, secreto, direccion), { value: valor });
        const c2 = await comprometer(juego, j2, Jugada.Piedra, valor);
        await malicioso.reveal(Jugada.Papel, secreto);
        const tx = await juego.connect(j2).reveal(c2.jugada, c2.secreto);
        if (ronda === 2) await expect(tx).to.changeEtherBalance(malicioso, POZO);
      }
      expect(await juego.ganador()).to.equal(direccion);
    });
  });
});
