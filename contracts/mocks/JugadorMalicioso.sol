// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Cachipun} from "../Cachipun.sol";

/// @dev Solo para tests: un jugador que es un contrato y se porta mal al recibir
///      Ether. Sirve para comprobar que el contrato del juego no se bloquea.
contract JugadorMalicioso {
    enum Modo { Acepta, Rechaza, ConsumeGas, Reentra }

    Cachipun public immutable juego;

    // Todo en un mismo slot, para que receive() gaste poco gas.
    Modo public modo;
    bool public reentradaExitosa;
    uint64 public intentosReentrada;
    uint64 public reentradasBloqueadas;

    constructor(Cachipun _juego) {
        juego = _juego;
    }

    function setModo(Modo _modo) external {
        modo = _modo;
    }

    function commit(bytes32 _hash) external payable {
        juego.commit{value: msg.value}(_hash);
    }

    function reveal(Cachipun.Jugada _jugada, bytes32 _secreto) external {
        juego.reveal(_jugada, _secreto);
    }

    function retirar() external {
        juego.retirar();
    }

    receive() external payable {
        if (modo == Modo.Rechaza) revert("No acepto Ether");
        if (modo == Modo.ConsumeGas) {
            while (true) {}
        }
        if (modo == Modo.Reentra) {
            // A mitad del pago intenta volver a entrar al juego por cada función que escribe.
            intentosReentrada += 1;
            _intentar(abi.encodeCall(Cachipun.nuevaPartida, ()));
            _intentar(abi.encodeCall(Cachipun.commit, (bytes32(uint256(1)))));
            _intentar(abi.encodeCall(Cachipun.reveal, (Cachipun.Jugada.Piedra, bytes32(0))));
            _intentar(abi.encodeCall(Cachipun.reclamarTimeout, ()));
            _intentar(abi.encodeCall(Cachipun.retirar, ()));
        }
    }

    /// @dev Cuenta como bloqueada solo si la revirtió el ReentrancyGuard.
    function _intentar(bytes memory _llamada) private {
        (bool ok, bytes memory razon) = address(juego).call(_llamada);
        if (ok) {
            reentradaExitosa = true;
        } else if (bytes4(razon) == ReentrancyGuard.ReentrancyGuardReentrantCall.selector) {
            reentradasBloqueadas += 1;
        }
    }
}
