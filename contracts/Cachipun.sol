// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Cachipún On-Chain (al mejor de tres)
/// @notice Piedra, papel o tijera entre dos jugadores con apuesta en Ether.
///         Cada ronda usa commit–reveal: primero se publica el hash de la jugada
///         y solo cuando ambos se comprometieron se revela. Gana la partida quien
///         gane primero 2 rondas; las rondas empatadas se repiten.
/// @dev Evaluación Parcial N°2 · BCY0010 Fundamentos de Blockchain · Duoc UC
contract Cachipun is ReentrancyGuard {
    // ───────────────────────────── Tipos ─────────────────────────────

    enum Jugada { Ninguna, Piedra, Papel, Tijera }

    enum Estado {
        EsperandoJugadores, // ronda 1: J1 abre la partida y J2 iguala la apuesta
        Comprometiendo,     // rondas 2+: ambos envían el hash de su jugada
        Revelando,          // ambos revelan jugada + secreto
        Finalizado,         // hubo ganador y se pagó el pozo
        Cancelado           // partida anulada y se devolvieron las apuestas
    }

    /// @dev El orden de los campos empaqueta addr, jugada, flags y victorias en
    ///      un solo slot de 32 bytes: el struct ocupa 3 slots en vez de 4.
    struct Jugador {
        address addr;
        Jugada jugada;
        bool comprometio;
        bool revelo;
        uint8 victorias;
        bytes32 hash;
        bytes32 ultimoSecreto; // secreto revelado en la ronda anterior (ya es público)
    }

    // ───────────────────────────── Estado ─────────────────────────────

    uint8 public constant VICTORIAS_PARA_GANAR = 2;

    /// @dev Gas que se reenvía en los pagos automáticos. Alcanza para una wallet
    ///      normal o una smart wallet, pero impide que un receptor malicioso
    ///      consuma todo el gas y bloquee el pago al rival.
    uint256 private constant GAS_PAGO = 50_000;

    uint256 public immutable duracionCommit;   // segundos para hacer commit
    uint256 public immutable duracionReveal;   // segundos para revelar
    uint256 public immutable bloqueDespliegue; // desde aquí se buscan los eventos (Etherscan)

    uint256 public partida; // número de partida actual (parte en 1)
    uint256 public ronda;   // ronda actual dentro de la partida (parte en 1)

    // estado, ganador y porAbandono comparten un slot.
    Estado public estado;
    address public ganador;  // ganador de la partida (queda hasta nuevaPartida)
    bool public porAbandono; // true si ganó porque el rival no cumplió un plazo

    Jugador public jugador1;
    Jugador public jugador2;

    uint256 public apuesta;     // monto que pone cada jugador (lo fija J1)
    uint256 public plazoCommit; // límite para la fase de commit vigente
    uint256 public plazoReveal; // límite para la fase de reveal vigente

    /// @notice Pagos que no se pudieron entregar automáticamente (ver retirar).
    mapping(address => uint256) public pendientes;

    // ───────────────────────────── Eventos ─────────────────────────────

    event NuevaPartida(uint256 indexed partida);
    event Commit(uint256 indexed partida, uint256 ronda, address indexed jugador, bytes32 hash, uint256 monto);
    event Reveal(uint256 indexed partida, uint256 ronda, address indexed jugador, Jugada jugada);
    event RondaGanada(uint256 indexed partida, uint256 ronda, address indexed ganador, uint8 victorias1, uint8 victorias2);
    event Empate(uint256 indexed partida, uint256 ronda);
    event Ganador(uint256 indexed partida, address indexed ganador, uint256 premio, bool porAbandono);
    event Anulado(uint256 indexed partida, string motivo);
    event PagoPendiente(address indexed destinatario, uint256 monto);
    event Retiro(address indexed destinatario, uint256 monto);

    // ─────────────────────────── Constructor ───────────────────────────

    /// @param _duracionCommit Segundos que tiene cada fase de commit (mínimo 60).
    /// @param _duracionReveal Segundos que tiene cada fase de reveal (mínimo 60).
    constructor(uint256 _duracionCommit, uint256 _duracionReveal) {
        require(_duracionCommit >= 1 minutes && _duracionReveal >= 1 minutes, "Plazo minimo: 1 minuto");
        duracionCommit = _duracionCommit;
        duracionReveal = _duracionReveal;
        bloqueDespliegue = block.number;
        partida = 1;
        ronda = 1;
        emit NuevaPartida(1);
    }

    // ─────────────────────── Funciones públicas ───────────────────────

    /// @notice Envía el hash de tu jugada. En la ronda 1 se envía junto con la apuesta.
    /// @param _hash keccak256(abi.encodePacked(jugada, secreto, tuDireccion)); ver generarHash.
    function commit(bytes32 _hash) external payable nonReentrant {
        require(_hash != bytes32(0), "Hash vacio");

        if (estado == Estado.EsperandoJugadores) {
            _registrar(_hash);
        } else if (estado == Estado.Comprometiendo) {
            require(block.timestamp <= plazoCommit, "Plazo de commit vencido");
            require(msg.value == 0, "La apuesta ya fue pagada");
            Jugador storage j = _jugadorDe(msg.sender);
            require(!j.comprometio, "Ya hiciste commit en esta ronda");
            require(!_reusaSecreto(_hash, j.ultimoSecreto, msg.sender), "Usa un secreto nuevo");

            j.hash = _hash;
            j.comprometio = true;
            emit Commit(partida, ronda, msg.sender, _hash, 0);

            if (jugador1.comprometio && jugador2.comprometio) _abrirReveal();
        } else if (estado == Estado.Revelando) {
            revert("Ronda en fase de reveal");
        } else {
            revert("La partida termino: llama a nuevaPartida()");
        }
    }

    /// @notice Revela tu jugada y el secreto que usaste en el commit.
    ///         Cuando ambos revelaron, el contrato resuelve la ronda solo.
    function reveal(Jugada _jugada, bytes32 _secreto) external nonReentrant {
        require(estado == Estado.Revelando, "No es fase de reveal");
        require(block.timestamp <= plazoReveal, "Plazo de reveal vencido");
        require(_jugada != Jugada.Ninguna, "Jugada invalida");
        Jugador storage j = _jugadorDe(msg.sender);
        require(!j.revelo, "Ya revelaste");
        require(generarHash(_jugada, _secreto, msg.sender) == j.hash, "No coincide con tu commit");

        j.jugada = _jugada;
        j.revelo = true;
        j.ultimoSecreto = _secreto;
        emit Reveal(partida, ronda, msg.sender, _jugada);

        if (jugador1.revelo && jugador2.revelo) _resolverRonda();
    }

    /// @notice Aplica las reglas de plazo vencido. Cualquiera puede llamarla:
    ///         los fondos siempre van a los jugadores, nunca a quien la llama.
    function reclamarTimeout() external nonReentrant {
        if (estado == Estado.EsperandoJugadores) {
            require(jugador1.addr != address(0), "No hay partida en curso");
            require(block.timestamp > plazoCommit, "El plazo de commit sigue vigente");
            _anular("Nadie igualo la apuesta");
        } else if (estado == Estado.Comprometiendo) {
            require(block.timestamp > plazoCommit, "El plazo de commit sigue vigente");
            _resolverAbandono(jugador1.comprometio, jugador2.comprometio, "Nadie hizo commit");
        } else if (estado == Estado.Revelando) {
            require(block.timestamp > plazoReveal, "El plazo de reveal sigue vigente");
            _resolverAbandono(jugador1.revelo, jugador2.revelo, "Nadie revelo");
        } else {
            revert("La partida ya termino");
        }
    }

    /// @notice Abre una partida nueva. Solo se puede cuando la actual terminó
    ///         (Finalizado o Cancelado): así el fin de cada partida queda explícito.
    function nuevaPartida() external nonReentrant {
        require(
            estado == Estado.Finalizado || estado == Estado.Cancelado,
            "La partida actual no ha terminado"
        );
        delete jugador1;
        delete jugador2;
        delete apuesta;
        delete plazoCommit;
        delete plazoReveal;
        delete ganador;
        delete porAbandono;
        estado = Estado.EsperandoJugadores;
        ronda = 1;
        partida += 1;
        emit NuevaPartida(partida);
    }

    /// @notice Retira un pago que no se pudo entregar automáticamente.
    function retirar() external nonReentrant {
        uint256 monto = pendientes[msg.sender];
        require(monto > 0, "No tienes saldo pendiente");
        pendientes[msg.sender] = 0;
        emit Retiro(msg.sender, monto);
        (bool ok, ) = payable(msg.sender).call{value: monto}("");
        require(ok, "Transferencia fallida");
    }

    /// @notice Calcula el hash que se envía en commit. Es `pure`: no lee ni escribe
    ///         la blockchain, así que consultarla desde Remix no gasta gas.
    function generarHash(Jugada _jugada, bytes32 _secreto, address _jugador) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(_jugada, _secreto, _jugador));
    }

    // ─────────────────────── Funciones internas ───────────────────────

    /// @dev Ronda 1: el primero en llamar es J1 y fija la apuesta; el segundo es J2.
    function _registrar(bytes32 _hash) private {
        if (jugador1.addr == address(0)) {
            require(msg.value > 0, "Debes apostar ETH");
            jugador1.addr = msg.sender;
            jugador1.hash = _hash;
            jugador1.comprometio = true;
            apuesta = msg.value;
            plazoCommit = block.timestamp + duracionCommit;
            emit Commit(partida, ronda, msg.sender, _hash, msg.value);
        } else {
            require(block.timestamp <= plazoCommit, "Plazo de commit vencido");
            require(msg.sender != jugador1.addr, "Ya estas en la partida");
            require(msg.value == apuesta, "Debes igualar la apuesta");
            jugador2.addr = msg.sender;
            jugador2.hash = _hash;
            jugador2.comprometio = true;
            emit Commit(partida, ronda, msg.sender, _hash, msg.value);
            _abrirReveal();
        }
    }

    function _abrirReveal() private {
        estado = Estado.Revelando;
        plazoReveal = block.timestamp + duracionReveal;
    }

    /// @dev Jugadas: 1 = Piedra, 2 = Papel, 3 = Tijera.
    ///      Gana J1 si (j1 - j2) mod 3 == 1. Se suma 3 antes de restar para no
    ///      hacer underflow (en Solidity 0.8 una resta negativa revierte).
    function _resolverRonda() private {
        uint8 a = uint8(jugador1.jugada);
        uint8 b = uint8(jugador2.jugada);

        if (a == b) {
            emit Empate(partida, ronda);
            _siguienteRonda();
            return;
        }

        Jugador storage g = (a + 3 - b) % 3 == 1 ? jugador1 : jugador2;
        g.victorias += 1;
        emit RondaGanada(partida, ronda, g.addr, jugador1.victorias, jugador2.victorias);

        if (g.victorias == VICTORIAS_PARA_GANAR) {
            _terminar(g.addr, false);
        } else {
            _siguienteRonda();
        }
    }

    function _siguienteRonda() private {
        ronda += 1;
        _limpiarRonda(jugador1);
        _limpiarRonda(jugador2);
        estado = Estado.Comprometiendo;
        plazoCommit = block.timestamp + duracionCommit;
    }

    function _limpiarRonda(Jugador storage _j) private {
        _j.jugada = Jugada.Ninguna;
        _j.comprometio = false;
        _j.revelo = false;
    }

    /// @dev Se llama con el plazo vencido. Quien no cumplió pierde la partida;
    ///      si ninguno cumplió, la partida se anula.
    function _resolverAbandono(bool _cumplio1, bool _cumplio2, string memory _motivo) private {
        if (_cumplio1 && !_cumplio2) {
            _terminar(jugador1.addr, true);
        } else if (_cumplio2 && !_cumplio1) {
            _terminar(jugador2.addr, true);
        } else {
            _anular(_motivo);
        }
    }

    /// @dev Checks-effects-interactions: primero se registra el resultado y
    ///      recién al final se transfiere el Ether.
    function _terminar(address _ganador, bool _porAbandono) private {
        uint256 premio = apuesta * 2;
        estado = Estado.Finalizado;
        ganador = _ganador;
        porAbandono = _porAbandono;
        emit Ganador(partida, _ganador, premio, _porAbandono);
        _pagar(_ganador, premio);
    }

    function _anular(string memory _motivo) private {
        address a1 = jugador1.addr;
        address a2 = jugador2.addr;
        uint256 monto = apuesta;
        estado = Estado.Cancelado;
        emit Anulado(partida, _motivo);
        _pagar(a1, monto);
        if (a2 != address(0)) _pagar(a2, monto);
    }

    /// @dev Pago "push" con respaldo "pull": si el destinatario rechaza el Ether
    ///      (por ejemplo un contrato sin receive), el monto queda en `pendientes`
    ///      para que lo retire después, y el pago al rival no se bloquea.
    function _pagar(address _a, uint256 _monto) private {
        (bool ok, ) = payable(_a).call{value: _monto, gas: GAS_PAGO}("");
        if (!ok) {
            pendientes[_a] += _monto;
            emit PagoPendiente(_a, _monto);
        }
    }

    function _jugadorDe(address _a) private view returns (Jugador storage) {
        if (_a == jugador1.addr) return jugador1;
        if (_a == jugador2.addr) return jugador2;
        revert("No eres jugador de esta partida");
    }

    /// @dev El secreto de la ronda anterior ya es público: si se reutiliza,
    ///      cualquiera puede probar las 3 jugadas y descubrir la nueva.
    ///      Solo se llama desde la ronda 2, cuando ambos ya revelaron un secreto.
    function _reusaSecreto(bytes32 _hash, bytes32 _secretoAnterior, address _jugador) private pure returns (bool) {
        for (uint8 m = uint8(Jugada.Piedra); m <= uint8(Jugada.Tijera); m++) {
            if (generarHash(Jugada(m), _secretoAnterior, _jugador) == _hash) return true;
        }
        return false;
    }
}
