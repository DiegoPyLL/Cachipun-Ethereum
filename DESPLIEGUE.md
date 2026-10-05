# Guía en Remix — Cachipún On-Chain

Todo se hace en **[Remix IDE](https://remix.ethereum.org)**, en el navegador. No hay que instalar nada.

- **Remix VM** (pasos 1 a 4): una blockchain simulada dentro del navegador, con cuentas de 100 ETH falsos. Sirve para aprender, practicar y probar las reglas gratis.
- **Sepolia** (paso 5): la rúbrica pide el contrato desplegado en una testnet. Se hace desde el mismo Remix, cambiando el entorno a MetaMask.

---

## 1. Abrir y compilar

1. **Crear el archivo:** en Remix, en el explorador de archivos, crea `contracts/Cachipun.sol` y pega el contenido de [contracts/Cachipun.sol](contracts/Cachipun.sol). El import de OpenZeppelin se descarga solo.
2. **Compilar:** en *Solidity Compiler*, elige la versión `0.8.28` (sirve cualquiera desde `0.8.24`) y presiona *Compile*. Debe aparecer un ✓ verde en el ícono.

---

## 2. Conocer Remix

El panel **Deploy & Run Transactions** (ícono *Deploy* en la barra izquierda) tiene todo lo necesario:

| Parte | Para qué sirve |
|-------|----------------|
| **Environment** | La red. **Remix VM** para practicar; **Injected Provider – MetaMask** para Sepolia. **Reset** reinicia Remix VM. |
| **Account** | Quién envía la transacción. En Remix VM, Account 1 es J1 y Account 2 es J2. |
| Pestaña **Deploy** | Crea el contrato. Su campo **Value** (el ETH que se envía, con su unidad `wei`, `gwei`, `finney` o `ether`) se usa solo al desplegar. |
| Pestaña **Deployed Contracts** | Los botones del contrato. Los que dicen **Transact** escriben en la blockchain y gastan gas. Los demás (`estado`, `jugador1`, `generarHash`…) son consultas gratis. Al final de la tarjeta del contrato, debajo de *Low level interaction*, está el **Value** que se envía al llamar funciones como `commit`. |
| **Terminal** (abajo) | El resultado de cada acción. Con la flechita **▾** se ve el detalle: *decoded input* (lo que enviaste), *decoded output* (la respuesta) y *logs* (los eventos). |

---

## 3. Jugar una partida en Remix VM

### Preparar

1. En *Environment*, elige **Remix VM** y presiona **Reset**: las cuentas vuelven a 100 ETH.
2. En la pestaña *Deploy*, escribe los plazos `600, 600` (10 minutos por fase, para practicar sin apuro), deja *Value* en `0` y presiona **Deploy**.
3. En *Deployed Contracts*, `estado` debe decir `0` y `partida` debe decir `1`.

### Cada ronda

Cada jugador lo hace desde su propia cuenta:

| # | Función | *Value* | Qué se ingresa |
|---|---------|---------|----------------|
| 1 | `generarHash` (consulta, gratis) | — | `jugada, secreto, dirección del jugador`. Copia el *output*: es el hash |
| 2 | `commit` → *Transact* | `1 ether` en la ronda 1 y `0` en las siguientes | El hash del paso 1 |
| 3 | `reveal` → *Transact*, cuando ambos hicieron commit | `0` | `jugada, secreto` |

- **Jugadas:** `1` = Piedra, `2` = Papel, `3` = Tijera.
- **Secreto:** un `bytes32`, o sea `0x` seguido de 64 caracteres hexadecimales.
- **Unidad del *Value*:** ojo, debe ser `1 ether`, no `1 wei`. Después del commit de J1, `apuesta` debe mostrar `1000000000000000000` (1 ether en wei).
- **Dirección en `generarHash`:** la consulta puede hacerse desde cualquier cuenta, pero la dirección que se ingresa debe ser la de quien después hace `commit` y `reveal`.

### Partida de ejemplo

J1 juega siempre Papel y gana 2-1:

| Ronda | J1 (Account 1) | J2 (Account 2) | Resultado |
|-------|----------------|----------------|-----------|
| 1 | `2` Papel | `1` Piedra | Gana J1 (1-0) |
| 2 | `2` Papel | `3` Tijera | Gana J2 (1-1) |
| 3 | `2` Papel | `1` Piedra | Gana J1 (2-1) y cobra el pozo |

Argumentos de `generarHash`, en orden (ronda 1 J1, ronda 1 J2, ronda 2 J1…). El `reveal` usa la misma línea sin la dirección:

```
2, 0x5555555555555555555555555555555555555555555555555555555555555555, 0x5B38Da6a701c568545dCfcB03FcB875f56beddC4
1, 0x6666666666666666666666666666666666666666666666666666666666666666, 0xAb8483F64d9C6d1EcF9b849Ae677dD3315835cb2
2, 0x7777777777777777777777777777777777777777777777777777777777777777, 0x5B38Da6a701c568545dCfcB03FcB875f56beddC4
3, 0x8888888888888888888888888888888888888888888888888888888888888888, 0xAb8483F64d9C6d1EcF9b849Ae677dD3315835cb2
2, 0x9999999999999999999999999999999999999999999999999999999999999999, 0x5B38Da6a701c568545dCfcB03FcB875f56beddC4
1, 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, 0xAb8483F64d9C6d1EcF9b849Ae677dD3315835cb2
```

- **Comprobación:** la primera línea debe devolver `0xfaed0376b7abbbe2c4ff769c42770867c1941227260cca546f6fc7c594cc60fd`.
- **Estos secretos son solo para practicar.** En el juego real deben ser aleatorios (ver paso 5.4).

**Resultado esperado:** `estado` = `3` (*Finalizado*), `ganador` = Account 1 y saldos de ~101 ETH y ~99 ETH. En la terminal, los *logs* de cada transacción muestran los eventos `Commit`, `Reveal`, `RondaGanada` y `Ganador`.

### Tabla de hashes para jugar libre

Con estas tablas no hace falta llamar `generarHash`. En cada ronda, cada jugador elige su jugada, pega el hash de su fila en `commit` y después revela con `jugada, secreto de esa ronda`. Por ejemplo, si J1 juega Tijera en la ronda 1, el `commit` lleva `0x7f0f…b454` y el `reveal` lleva `3, 0x5555…5555` (el secreto completo).

#### J1 · Account 1 · `0x5B38Da6a701c568545dCfcB03FcB875f56beddC4`

| Ronda | Secreto (para el `reveal`) |
|:-----:|----------------------------|
| 1 | `0x5555555555555555555555555555555555555555555555555555555555555555` |
| 2 | `0x7777777777777777777777777777777777777777777777777777777777777777` |
| 3 | `0x9999999999999999999999999999999999999999999999999999999999999999` |
| 4 | `0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb` |

| Ronda | Jugada | Hash para `commit` |
|:-----:|--------|--------------------|
| 1 | ✊ 1 Piedra | `0xab6d7abdfb7399140dd65feff53906f73cd866fd1ce32aab581de4d9847529ef` |
| 1 | 📄 2 Papel | `0xfaed0376b7abbbe2c4ff769c42770867c1941227260cca546f6fc7c594cc60fd` |
| 1 | ✌️ 3 Tijera | `0x7f0f067786bba2172b59a71b46add9031162e0cd2bcd7ecf7b2a1677280ab454` |
| 2 | ✊ 1 Piedra | `0x9a5b19cd3ead1e3fa7730b9e50c58e423848fd6c53b27a8d43d340e9436dfc2f` |
| 2 | 📄 2 Papel | `0xfad4dd3866381b78fe45d6868746ff53eb36d4c14fcff2ff14f9b0d5acfe6216` |
| 2 | ✌️ 3 Tijera | `0x537e8bc12725e9934766daea9d0370515399dd35f608fbe95c8b4863cb6e47c4` |
| 3 | ✊ 1 Piedra | `0x9f8dbe72079ae9fe6e5674947c9f883eb0bf8f19fa1f1f72ebbac0c3543a3dde` |
| 3 | 📄 2 Papel | `0x61401e7ac60676dc9467bbc7e5f5b2a53acbc04758c969b3ed1985572198d17f` |
| 3 | ✌️ 3 Tijera | `0xc0ac65fa9765067bbc801cf002faa08d2f0089de0fb71e9e0ae54592d9a60ff6` |
| 4 | ✊ 1 Piedra | `0xd51d3cf0ef41814a9dc331ca61283ae40bed6d833ec3bb234093a3d69aaa6d0a` |
| 4 | 📄 2 Papel | `0xfa51a65e0a096622dc6e2384fd737971d000877ebfb7bdd013fcf7d3bdb88103` |
| 4 | ✌️ 3 Tijera | `0x0e34dab4174cffcdd8985916be305cc04669b7c2fc85afe44438bebd5237f68a` |

#### J2 · Account 2 · `0xAb8483F64d9C6d1EcF9b849Ae677dD3315835cb2`

| Ronda | Secreto (para el `reveal`) |
|:-----:|----------------------------|
| 1 | `0x6666666666666666666666666666666666666666666666666666666666666666` |
| 2 | `0x8888888888888888888888888888888888888888888888888888888888888888` |
| 3 | `0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` |
| 4 | `0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc` |

| Ronda | Jugada | Hash para `commit` |
|:-----:|--------|--------------------|
| 1 | ✊ 1 Piedra | `0x69af45aaf6a7d1fae05752eb5541d428bc258c741a26ca4bc71b4130bbdb5ddb` |
| 1 | 📄 2 Papel | `0x5f2eb26ec9f3d6be22b385b68c7384727865efd819d1148cfeb1b3678bdd4aea` |
| 1 | ✌️ 3 Tijera | `0x28a7a77ad89beba205a8b5d3319239c40279cd81160fbb413eace921d9390ffb` |
| 2 | ✊ 1 Piedra | `0x1f51aab237e708b975949db7667450023eeefadd2161b4f52d8cbd155ec197c7` |
| 2 | 📄 2 Papel | `0xe75bb24063e455cb56d17c03412abd66d9acf8f8df107849895a498fdc31df42` |
| 2 | ✌️ 3 Tijera | `0xed23932ad4b3efa6baade34ff95516b2bfd055d2aa44f1a4d9ece2dae06d2b11` |
| 3 | ✊ 1 Piedra | `0xd30956b30e565f6554f85489a343f573c41469fb16788312de0920212d8a6182` |
| 3 | 📄 2 Papel | `0x088c6b37c9fec9e81699065a5d29c7c255073964b8f0ea3bad8fb5320bd351a3` |
| 3 | ✌️ 3 Tijera | `0xb1243da9a30e17d816a311227a0b102ccc431e91a7f41f9f6ad79a25b96d64d6` |
| 4 | ✊ 1 Piedra | `0x0ff33037f0d4726141990c8b8d3b571eed69ad3ec0ce951b085415a2d4e20498` |
| 4 | 📄 2 Papel | `0xb1865b96f6764e34e19d64630660efa5d65988f336ba59ae8d2d06134d822885` |
| 4 | ✌️ 3 Tijera | `0x5e71d1242117977cb949562fd3a205752407f395ddf4c3d8cf12b8b16b488654` |

- **La ronda 4 solo se usa si hubo un empate,** porque el empate también hace avanzar `ronda`. Si hay más empates, calcula el hash con `generarHash` y un secreto nuevo (por ejemplo `0xdddd…` para J1 y `0xeeee…` para J2).
- **Los hashes sirven en cualquier contrato desplegado en Remix VM,** porque dependen solo de la jugada, el secreto y la dirección. Después de `nuevaPartida` se vuelve a la ronda 1.
- **Por qué el secreto debe ser aleatorio:** con esta tabla, cualquiera que vea un hash en un `commit` sabe la jugada de inmediato. Con un secreto conocido solo hay 3 posibilidades y se adivinan; con uno aleatorio de 32 bytes, no.

### Leer el estado

| Consulta | Qué muestra |
|----------|-------------|
| `estado` | `0` esperando apuestas (ronda 1) · `1` commits de las rondas 2+ · `2` revelando · `3` finalizada · `4` anulada |
| `partida`, `ronda` | Número de partida y de ronda |
| `apuesta` | Lo que apostó cada jugador, en wei (1 ether = `1000000000000000000`) |
| `jugador1`, `jugador2` | `addr`, `jugada`, `comprometio`, `revelo`, `victorias`, `hash` y `ultimoSecreto`. `jugada` vale `0` hasta que el jugador revela, y vuelve a `0` cuando se resuelve la ronda |
| `ganador`, `porAbandono` | Resultado de la última partida |
| `plazoCommit`, `plazoReveal` | Hora límite de la fase, en segundos Unix |
| `pendientes` (con una dirección) | Pagos que quedaron por retirar con `retirar` |

Qué jugó cada uno en cada ronda queda en los eventos `Reveal`, en los *logs* de la terminal.

---

## 4. Probar las reglas

Cada prueba parte con una partida nueva: `nuevaPartida` si la anterior terminó, o **Deploy** otra vez. El motivo del rechazo aparece en la terminal (*Reason provided by the contract*).

| Prueba | Cómo | Resultado |
|--------|------|-----------|
| Revelar antes de tiempo | Solo J1 hizo commit y J1 llama `reveal` | *"No es fase de reveal"* |
| Apostar distinto | J2 hace commit con *Value* `2 ether` | *"Debes igualar la apuesta"* |
| Cambiar la jugada | J1 se comprometió con Papel y revela `1, <su secreto>` | *"No coincide con tu commit"* |
| Revelar por otro | Account 2 llama `reveal` con la jugada y el secreto de J1 | *"No coincide con tu commit"*: el hash incluye la dirección, así que solo el dueño revela |
| Repetir el secreto | En la ronda 2, J1 hace commit con un hash de su fila de ronda 1 | *"Usa un secreto nuevo"* |
| Tercera cuenta | En la ronda 2, Account 3 llama `commit` | *"No eres jugador de esta partida"* |
| Reclamar antes de tiempo | `reclamarTimeout` con el plazo vigente | *"El plazo de … sigue vigente"* |

**Timeouts.** Despliega con plazos de `60, 60`, el mínimo. Remix VM usa la hora real, así que hay que esperar 1 minuto antes de llamar `reclamarTimeout`, que puede llamar cualquier cuenta:

| Caso | Cómo | Resultado |
|------|------|-----------|
| Nadie iguala la apuesta | Solo J1 hace commit | `estado` = `4` y J1 recupera su apuesta |
| Uno no revela | Ambos hacen commit y solo J1 revela | `estado` = `3`, `ganador` = J1, `porAbandono` = `true` y J1 cobra el pozo |
| Nadie revela | Ambos hacen commit y nadie revela | `estado` = `4` y cada uno recupera su apuesta |

---

## 5. Desplegar en Sepolia (entrega)

Es lo mismo que en Remix VM, pero en una red pública: cada transacción la firma MetaMask y queda visible en Etherscan.

### 5.1 Preparar MetaMask

1. **Activar Sepolia:** instala la extensión MetaMask y, en el selector de redes, activa *Mostrar redes de prueba* y elige **Sepolia**.
2. **Crear las cuentas:** crea **2 cuentas solo de prueba**, una para cada jugador. No uses cuentas con fondos reales.
3. **Pedir ETH de Sepolia** (gratis) para la cuenta de J1 en un faucet, por ejemplo:
   - [Google Cloud Web3 Faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia): solo pide iniciar sesión con Google.
   - [Sepolia PoW Faucet](https://sepolia-faucet.pk910.de): se "mina" en el navegador unos minutos y no pide cuenta.
4. **Pasar ETH a J2:** desde MetaMask, envía una parte a la cuenta de J2.

**¿Cuánto se necesita?** Con el gas cerca de 1 gwei, el despliegue cuesta ~0,003 ETH y la demostración completa ~0,005 ETH. Con 0,02 ETH entre las dos cuentas sobra. Las apuestas no se pierden: el pozo vuelve a una de tus cuentas.

### 5.2 Desplegar

1. En *Environment*, elige **Injected Provider – MetaMask** y acepta la conexión. *Account* debe mostrar la cuenta de J1 y la red debe ser Sepolia (`11155111`).
2. Escribe los plazos `300, 300` (5 minutos por fase). Si en la demo quieres mostrar un timeout, usa `120, 120`.
3. Deja *Value* en `0`, presiona **Deploy** y confirma en MetaMask.
4. Copia la **dirección del contrato** desde *Deployed Contracts*. En la terminal está el link a la transacción en Sepolia Etherscan.

### 5.3 Verificar el código (recomendado)

En el *Plugin Manager* de Remix, activa **Contract Verification**. Elige Sepolia, pega la dirección y los argumentos del constructor (los plazos que usaste) y verifica en Etherscan. Etherscan pide una [API key gratuita](https://etherscan.io/myapikey).

Con el código verificado, cualquiera puede leer en Etherscan el contrato que custodia el pozo. Es un buen argumento de transparencia para el pitch.

### 5.4 Jugar

1. **Generar un secreto aleatorio para cada jugada.** En cualquier página, abre la consola del navegador (F12 → *Console*), pega esto y presiona Enter:

   ```js
   '0x' + [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('')
   ```

   Si Chrome no deja pegar, primero escribe `allow pasting`. **Anota el secreto:** sin él no puedes revelar y pierdes la partida.
2. **Calcular el hash en Remix VM.** Abre Remix en otra pestaña, despliega una copia en **Remix VM** y usa `generarHash` con tu jugada, tu secreto y tu dirección de MetaMask. Como `generarHash` es `pure`, da el mismo hash que en Sepolia, y el secreto no sale de tu navegador antes de tiempo. Si la consultaras en Sepolia, pasaría por el nodo RPC.
3. **Commit:** en la pestaña de Sepolia, J1 llama `commit(hash)` con *Value* = la apuesta, por ejemplo `1 finney` (0,001 ETH). Confirma en MetaMask y espera a que se confirme (unos 12 s).
4. **J2:** cambia de cuenta en MetaMask (el *Account* de Remix se actualiza solo) y hace su commit con **el mismo *Value***. Si J2 juega desde otro computador, abre Remix, compila, elige *Injected Provider – MetaMask* y carga el contrato con **At Address** (o *Add Contract*) pegando la dirección.
5. **Reveal** con *Value* `0`. En las rondas siguientes, `commit` y `reveal` van con *Value* `0` y un secreto nuevo.
6. Los timeouts y `nuevaPartida` funcionan igual que en Remix VM.

### 5.5 Revisar en Etherscan y registrar

En `https://sepolia.etherscan.io/address/<DIRECCION>`:

- **Transacciones:** cada `commit`, `reveal` y `reclamarTimeout`, con quién la envió.
- **Un `commit`:** en *Input Data* solo se ve el hash, no la jugada (commit–reveal).
- **Un `reveal`:** expone la jugada y el secreto. Cualquiera puede comprobar con `generarHash` que dan el hash del commit.
- **Pestaña *Events*:** `Commit`, `Reveal`, `RondaGanada`, `Ganador` y `Anulado`, con su número de partida y ronda (trazabilidad).
- **Pestaña *Internal Txns*:** la transferencia del pozo al ganador o los reembolsos (pago automático).

Para terminar, pega la dirección en el [README](README.md), en la línea *"Dirección del contrato en Sepolia"*, y entrégala en AVA junto con el link al repositorio.

---

## 6. Capturas para el informe

La rúbrica pide capturas de despliegue y de ejecución en testnet. Una lista que cubre el informe:

- [ ] Remix con el contrato compilado (✓) y el despliegue en Sepolia con la dirección.
- [ ] La transacción de despliegue en Sepolia Etherscan.
- [ ] La pestaña *Contract* de Etherscan con el código verificado (✓).
- [ ] Una transacción `commit` en Etherscan: solo se ve el hash.
- [ ] Una transacción `reveal` y `generarHash` dando el mismo hash del commit (autenticidad de la jugada).
- [ ] La pestaña *Events* del contrato (trazabilidad).
- [ ] La pestaña *Internal Txns* con el pago del pozo al ganador (pago automático).
- [ ] Un caso de timeout resuelto con `reclamarTimeout` (análisis de seguridad).
- [ ] Las pruebas del paso 4 en Remix VM, con el mensaje de rechazo en la terminal (el contrato se defiende de las trampas).

---

## 7. Solución de problemas

| Problema | Solución |
|----------|----------|
| *"invalid BytesLike value"* | El secreto está incompleto o los argumentos van en otro orden. Un `bytes32` es `0x` seguido de 64 caracteres |
| Un `reveal` revierte y la nota menciona *payable* | Quedó *Value* distinto de `0`, y `reveal` no recibe ETH |
| *"Debes apostar ETH"* | *Value* quedó en `0` en el commit de J1 |
| *"Debes igualar la apuesta"* | J2 puso otro monto u otra unidad (`wei` en vez de `ether`) |
| *"No coincide con tu commit"* | La jugada, el secreto o la **cuenta** elegida no son los mismos que se usaron en `generarHash` |
| *"Usa un secreto nuevo"* | Se repitió el secreto de la ronda anterior, que ya es público |
| *"No eres jugador de esta partida"* | La cuenta elegida no es J1 ni J2 |
| *"Plazo de commit vencido"* o *"Plazo de reveal vencido"* | Pasó el plazo: llama `reclamarTimeout` y después `nuevaPartida` |
| *"La partida termino: llama a nuevaPartida()"* | La partida anterior ya terminó: presiona `nuevaPartida` |
| Remix avisa que la estimación de gas falló | La transacción va a revertir: lee el motivo y presiona *Cancel* en vez de enviarla |
| Remix VM: desaparecieron el contrato y los saldos | Se recargó la página o se presionó *Reset*: Remix VM parte de cero y hay que desplegar de nuevo |
| Sepolia: Remix no muestra la cuenta de MetaMask | Elige *Injected Provider – MetaMask*, acepta la conexión y revisa que MetaMask esté en Sepolia |
| Sepolia: falta ETH para el gas | Pide más en un faucet (paso 5.1) |
