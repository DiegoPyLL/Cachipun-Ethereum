# Guía de despliegue — Cachipún On-Chain

Pasos para desplegar el contrato en la testnet **Sepolia**, jugar una partida con la DApp y sacar las capturas que pide el informe. Hay dos formas de desplegar:

- **Opción A, con el script de Hardhat:** un solo comando que revisa el saldo, despliega, verifica el código en Etherscan y guarda un registro del despliegue. Requiere exportar la llave privada de una cuenta de pruebas.
- **Opción B, con Remix y MetaMask:** no hay que exportar la llave privada, pero cada paso es manual.

Antes de gastar ETH de testnet conviene ensayar en local (paso 6).

---

## 1. Requisitos

| Qué | Para qué | Cómo comprobarlo |
|-----|----------|------------------|
| **Node.js 20 o superior** | Correr Hardhat, los tests y la DApp | `node --version` |
| **Dependencias del proyecto** | Hardhat, OpenZeppelin y ethers | `npm install` en la carpeta del proyecto |
| **MetaMask** (extensión del navegador) | Firmar las transacciones | El ícono del zorro en el navegador |
| **2 cuentas de MetaMask solo de pruebas** | Una para cada jugador. La primera también despliega | No uses cuentas con fondos reales |
| **ETH de Sepolia en ambas cuentas** | Pagar el gas del despliegue, las apuestas y el gas de cada jugada | El saldo en MetaMask con la red Sepolia elegida |
| *Opcional:* **API key de Etherscan** | Publicar el código fuente del contrato (verificación) | Cuenta gratis en [etherscan.io](https://etherscan.io/myapikey) |
| *Opcional:* **URL RPC de Alchemy o Infura** | Usarla si el RPC público configurado falla | Cuenta gratis en Alchemy o Infura |

**¿Cuánto ETH de Sepolia necesito?**

- **Desplegar:** el despliegue usa unos **2,96 millones de gas**. El costo en ETH depende del precio del gas en ese momento; el script te muestra el costo máximo antes de enviar nada.
- **Jugar una partida:** cada jugador necesita la apuesta (por ejemplo 0,001 ETH) más el gas de sus 4 a 6 transacciones. Una partida completa usa unos 662.500 de gas entre los dos jugadores.

---

## 2. Preparar MetaMask

1. **Activar Sepolia:** en el selector de redes de MetaMask, activa *Mostrar redes de prueba* y elige **Sepolia**.
2. **Crear las cuentas:** crea (o importa) **2 cuentas solo de pruebas**, una para el Jugador 1 y otra para el Jugador 2.
3. **Pedir ETH de Sepolia** para cada cuenta en un *faucet*. Por ejemplo:
   - [Google Cloud Web3 Faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) (pide iniciar sesión con Google).
   - [Sepolia PoW Faucet](https://sepolia-faucet.pk910.de) (se "mina" en el navegador unos minutos).
4. **Para jugar con las 2 cuentas a la vez**, abre la DApp en **dos perfiles distintos del navegador**, cada uno con su MetaMask y su cuenta. Así cada jugador guarda su propio secreto.

---

## 3. Instalar y probar el proyecto

```bash
git clone https://github.com/DiegoPyLL/Cachipun-Ethereum.git
cd Cachipun-Ethereum
npm install
npm test
```

Deberías ver **`58 passing`**. Si algo falla aquí, no sigas: el problema está en la instalación y no en Sepolia.

---

## 4. Desplegar

### Opción A: con el script ([scripts/desplegar.js](scripts/desplegar.js))

**4.1 Guardar los datos de la cuenta.** Hardhat los guarda fuera del repositorio. Cada comando pide el valor; pégalo y presiona Enter.

```bash
npx hardhat vars set SEPOLIA_PRIVATE_KEY   # llave privada de la cuenta de pruebas del Jugador 1
npx hardhat vars set ETHERSCAN_API_KEY     # opcional: para verificar el código en Etherscan
npx hardhat vars set SEPOLIA_RPC_URL       # opcional: tu URL de Alchemy o Infura
```

- **Exportar la llave privada:** se hace en MetaMask, en los detalles de la cuenta (*Mostrar clave privada*). El nombre exacto puede variar según la versión.
- **Dónde quedan los datos:** en tu carpeta de usuario, **en texto plano**; `npx hardhat vars path` muestra la ruta. Por eso la cuenta debe ser solo de pruebas.
- **Nunca pongas la llave en un archivo del proyecto** ni la subas a GitHub.

**4.2 Desplegar.**

```bash
npm run desplegar:sepolia
```

Por defecto, cada fase (commit y reveal) dura **300 s**. Para usar otros plazos en PowerShell (con plazos cortos es más fácil mostrar un timeout en la demo):

```powershell
$env:DURACION_COMMIT=120; $env:DURACION_REVEAL=120; npm run desplegar:sepolia
```

Antes de enviar, el script muestra la cuenta, el saldo y el costo máximo. Si falta la llave o el saldo no alcanza, se detiene sin gastar nada. La salida se ve así (con tus direcciones):

```
Red:     sepolia (chainId 11155111)
Cuenta:  0x…
Saldo:   0.05 ETH
Plazos:  commit 300 s · reveal 300 s
Gas:     2.960.116 (costo máximo ≈ … ETH)

Transacción enviada: 0x…
  https://sepolia.etherscan.io/tx/0x…

Cachipun desplegado en sepolia
  Contrato:  0x…
  Bloque:    … · gas usado 2.960.116
  Etherscan: https://sepolia.etherscan.io/address/0x…
  DApp:      http://localhost:8080/?red=sepolia&contrato=0x…  (con `npm run dapp` corriendo)
  Registro:  despliegues/sepolia.json
```

**4.3 Verificar el código en Etherscan.**

- **Con `ETHERSCAN_API_KEY` configurada:** el script espera 5 confirmaciones (alrededor de un minuto) y publica el código solo.
- **Sin ella:** el script imprime el comando para hacerlo después:

  ```bash
  npx hardhat verify --network sepolia <DIRECCION_DEL_CONTRATO> 300 300
  ```

  Los dos números son los plazos que usaste al desplegar.

Con el código verificado, cualquiera puede leer en Etherscan el contrato que custodia el pozo. Es un buen argumento de transparencia para el pitch.

**4.4 Borrar la llave privada** de Hardhat cuando ya no la necesites:

```bash
npx hardhat vars delete SEPOLIA_PRIVATE_KEY
```

### Opción B: con Remix y MetaMask

1. **Crear el archivo:** abre [Remix IDE](https://remix.ethereum.org) y crea `Cachipun.sol` con el contenido de [contracts/Cachipun.sol](contracts/Cachipun.sol). El import de OpenZeppelin se resuelve solo.
2. **Compilar:** en *Solidity Compiler*, elige la versión `0.8.28` (sirve cualquiera desde `0.8.24`) y compila.
3. **Conectar MetaMask:** en *Deploy & Run*, elige **Injected Provider – MetaMask**, con MetaMask en la red Sepolia.
4. **Desplegar:** junto al botón *Deploy*, completa los plazos en segundos (por ejemplo `300, 300`), despliega y confirma en MetaMask.
5. **Copiar la dirección:** está en *Deployed Contracts*.
6. **Verificar el código:** usa el plugin *Contract Verification* de Remix.

---

## 5. Registrar el despliegue

1. **README:** pega la dirección en la línea *"Dirección del contrato en Sepolia"*.
2. **Registro (solo opción A):** sube al repositorio `despliegues/sepolia.json`, que tiene la dirección, la transacción, el bloque y la fecha:

   ```bash
   git add despliegues/sepolia.json README.md
   git commit -m "Despliegue en Sepolia"
   git push
   ```

3. **AVA:** entrega la dirección del contrato y el link al repositorio.

---

## 6. Ensayar en local (sin gastar ETH de testnet)

Usa tres terminales en la carpeta del proyecto:

```bash
npm run nodo              # terminal 1: blockchain local con 20 cuentas de prueba (déjala abierta)
npm run desplegar:local   # terminal 2: despliega con plazos de 120 s e imprime el link de la DApp
npm run dapp              # terminal 3: sirve la DApp en http://localhost:8080
```

1. **Agregar la red local a MetaMask:** abre el link que imprimió `desplegar:local` y presiona *Conectar MetaMask*. La DApp ofrece agregar la red **Hardhat local** (`http://127.0.0.1:8545`, chain ID `31337`).
2. **Importar 2 cuentas:** usa 2 de las llaves privadas que imprime `npm run nodo`. Son públicas: **nunca** las uses en una red real.
3. **Jugar una partida completa** como en el paso 7.
4. **Si reinicias el nodo**, borra los datos de actividad de esas cuentas en MetaMask (*Configuración → Avanzado*). Si no, las transacciones fallan por el nonce.

---

## 7. Jugar con la DApp

```bash
npm run dapp
```

Abre `http://localhost:8080/?red=sepolia&contrato=<DIRECCION>`. La DApp debe abrirse así, servida por http: si abres `index.html` directo, MetaMask no se conecta.

1. **J1 abre la partida:** *Conectar MetaMask* → elige piedra, papel o tijera → escribe la apuesta → *Apostar y enviar commit*.
2. **J1 invita al rival:** con *Copiar link para invitar*, comparte el link con J2.
3. **J2 se une:** en su perfil, abre el link → *Conectar* → elige su jugada → *Igualar … y enviar commit*.
4. **Ambos revelan:** cada uno presiona *Revelar jugada*. Cuando revela el segundo, el contrato resuelve la ronda solo.
5. **Rondas siguientes:** igual que antes, pero sin ETH. Gana la partida quien llegue primero a 2 victorias, y el contrato le transfiere el pozo automáticamente.
6. **Abrir otra partida:** con *Abrir la partida #N*.

**Si alguien no juega a tiempo:** cuando vence el plazo se habilita *Reclamar timeout*. Quien no cumplió pierde la partida; si nadie cumplió, se anula y se devuelven las apuestas.

**El secreto de cada jugada** queda guardado en el navegador de quien la hizo. Si vas a revelar desde otro equipo, usa antes *Copiar respaldo* y después la opción *Revelar con un respaldo*.

**Sin MetaMask**, la DApp funciona en **modo espectador**: muestra la partida y los eventos en vivo, pero no permite jugar.

### Alternativa: jugar solo desde Remix

1. **Generar un secreto de 32 bytes** para cada ronda (nunca repitas uno):

   ```bash
   node -e "console.log('0x'+require('crypto').randomBytes(32).toString('hex'))"
   ```

2. **Calcular el hash** con `generarHash(jugada, secreto, tuDireccion)`. Las jugadas son `1` = Piedra, `2` = Papel y `3` = Tijera. Es una consulta y no gasta gas, pero el secreto pasa por el nodo RPC de MetaMask; la DApp, en cambio, lo calcula sin salir del navegador.
3. **Commit:** `commit(hash)`, con *Value* = apuesta en la ronda 1 y `0` en las rondas siguientes.
4. **Reveal:** `reveal(jugada, secreto)`, cuando ambos hicieron commit.
5. **Según el caso:** `reclamarTimeout()`, `nuevaPartida()` o `retirar()`.

---

## 8. Capturas para el informe

La rúbrica pide capturas de despliegue y de ejecución en testnet. Una lista que cubre el informe:

- [ ] Salida de `npm run desplegar:sepolia` (o Remix) con la dirección del contrato.
- [ ] La transacción de despliegue en Sepolia Etherscan.
- [ ] La pestaña *Contract* de Etherscan con el código verificado (✓).
- [ ] La DApp en cada fase: partida abierta, fase de reveal (marcador e historial de rondas) y partida terminada con el banner del ganador.
- [ ] Una transacción `commit` en Etherscan: solo se ve el hash, no la jugada (commit–reveal).
- [ ] La pestaña *Events* del contrato, con `Commit`, `Reveal`, `RondaGanada` y `Ganador` (trazabilidad).
- [ ] La pestaña *Internal Txns*, con la transferencia del pozo al ganador (pago automático).
- [ ] Un caso de timeout resuelto con `reclamarTimeout()` (análisis de seguridad).
- [ ] La salida de `npm test` y de `npm run coverage` (el contrato funciona sin errores).

---

## 9. Solución de problemas

| Problema | Solución |
|----------|----------|
| `No hay una cuenta para desplegar en sepolia` | Falta la llave: `npx hardhat vars set SEPOLIA_PRIVATE_KEY` |
| `Saldo insuficiente para desplegar` | Pide más ETH de Sepolia en un faucet para esa cuenta |
| El script se queda esperando o da error de red (`429`, `timeout`) | El RPC público está saturado. Configura uno propio: `npx hardhat vars set SEPOLIA_RPC_URL` |
| La verificación falla con *"does not have bytecode"* | Etherscan aún no indexa el contrato. Espera un minuto y repite `npx hardhat verify …` |
| La DApp dice *"No hay un contrato en 0x… en Sepolia"* | Revisa la dirección y que el selector de red diga **Sepolia** |
| La DApp dice *"Sin MetaMask · modo espectador"* | Abre la DApp con `npm run dapp` (no como archivo) y revisa que MetaMask esté instalada en ese perfil |
| MetaMask está en otra red | Presiona *Conectar* en la DApp y acepta el cambio a Sepolia |
| *"No encontré tu secreto en este navegador"* al revelar | Revela desde el mismo perfil donde hiciste el commit, o pega tu respaldo en *Revelar con un respaldo* |
| *"Debes igualar la apuesta"* | J2 debe enviar exactamente la apuesta de J1; la DApp la completa sola |
| *"La partida termino: llama a nuevaPartida()"* | La partida anterior ya terminó: presiona *Abrir la partida #N* |
| En local, MetaMask da errores de *nonce* | Reiniciaste el nodo: borra los datos de actividad de la cuenta en MetaMask |
