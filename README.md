<div align="center">

# 🧹 Build Cleaner

**Encontre projetos iOS, Android, Flutter, React Native e Node esquecidos no seu disco e libere gigabytes de arquivos de build com um clique.**

![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)
![Zero dependências](https://img.shields.io/badge/depend%C3%AAncias-0-brightgreen)
![macOS](https://img.shields.io/badge/macOS-suportado-000000?logo=apple&logoColor=white)
![Linux](https://img.shields.io/badge/Linux-suportado-FCC624?logo=linux&logoColor=black)

</div>

<!-- Adicione um print da interface aqui: ![Build Cleaner](docs/screenshot.png) -->

---

Pastas como `DerivedData`, `.gradle`, `build/`, `.dart_tool` e `node_modules` crescem silenciosamente até ocupar dezenas de GB. O **Build Cleaner** varre uma pasta, identifica cada projeto, mostra quanto espaço cada pasta de build ocupa e deixa você escolher o que apagar — com segurança e um contador de quanto você já economizou.

## ✨ Recursos

- 🔍 **Detecção automática** de projetos iOS (Xcode/CocoaPods/SwiftPM), Android (Gradle), Flutter, React Native/Expo e Node (Next.js, Nuxt, SvelteKit, Angular, Turborepo…)
- 📊 **Tamanho de cada pasta** calculado em paralelo, projetos ordenados do maior para o menor
- 🗑️ **Envio para a Lixeira** por padrão (ou exclusão permanente, se preferir)
- 🔗 **DerivedData global** do Xcode associado ao projeto de origem
- ⚠️ **Aviso de ferramentas abertas** (Xcode, Android Studio, daemons do Gradle), com botão para encerrar os daemons
- 📈 **Contador de economia** persistente, com histórico das últimas limpezas
- 🔒 **Servidor somente local**, protegido por token e contra CSRF/DNS rebinding
- 📦 **Zero dependências**: só Node.js — nada de `npm install`
- 🌗 Interface web com tema claro/escuro e filtros por plataforma

## 🚀 Começando

**Requisitos:** Node.js 18 ou superior.

```bash
git clone https://github.com/leofazanaro/Build-junk-cleaner.git
cd Build-junk-cleaner
npm start
```

O navegador abre em `http://localhost:4321`. Então:

1. Escolha a pasta (botão **Escolher pasta…** no macOS, ou digite o caminho — `~` funciona)
2. Clique em **Escanear**
3. Revise a lista — os itens recomendados já vêm marcados
4. Clique em **Deletar selecionados** e confirme

### Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `4321` | Porta do servidor local |
| `NO_OPEN` | — | Defina como `1` para não abrir o navegador automaticamente |

```bash
PORT=5000 NO_OPEN=1 npm start
```

## 📂 O que é detectado

| Plataforma | Detectado por | Pastas listadas |
|---|---|---|
| **iOS** | `*.xcodeproj`, `*.xcworkspace` ou `Podfile` | `build/`, `DerivedData/` local, `.build/` (SwiftPM), DerivedData global em `~/Library/Developer/Xcode/DerivedData` ligado ao projeto, `Pods/` *(opcional)* |
| **Android** | `settings.gradle(.kts)`, ou `build.gradle` + `gradlew`, com plugin Android | `.gradle/`, `.kotlin/`, `build/` da raiz e de cada módulo, `.cxx/` e `.externalNativeBuild/` (NDK) |
| **Flutter** | `pubspec.yaml` com `sdk: flutter` | `build/`, `.dart_tool/` |
| **React Native** | `package.json` com `react-native` ou `expo` | Tudo de Node, mais `.expo/`; as pastas `android/` e `ios/` aparecem como projetos próprios |
| **Node** | qualquer outro `package.json` | `node_modules/` *(opcional)*, `dist/`, `coverage/`, `.next/`, `.nuxt/`, `.output/`, `.svelte-kit/`, `.angular/`, `.turbo/`, `.parcel-cache/` |

> [!NOTE]
> Itens **opcionais** (como `Pods/` e `node_modules/`) não vêm selecionados por padrão, porque recriá-los exige baixar as dependências de novo.
>
> `dist/` e `coverage/` às vezes são versionados, então só vêm marcados quando aparecem no `.gitignore` do projeto ou de uma pasta acima dele, até a raiz do repositório.

Projetos aninhados são tratados corretamente: um app Flutter ou React Native com `android/` e `ios/` aparece como três projetos, cada pacote de um monorepo aparece separado, e uma mesma pasta nunca é listada duas vezes.

## 📈 Contador de economia

Cada limpeza é registrada em `~/.build-cleaner/stats.json` — total liberado, número de pastas e histórico das últimas 200 limpezas. O total aparece no topo do app e o histórico em **Ver histórico**.

## 🔒 Segurança

O app apaga pastas do seu disco, então foi construído com várias camadas de proteção:

- **Lixeira por padrão** — macOS: `/usr/bin/trash` (macOS 15+) ou o Finder; Linux: `gio trash`. O espaço só é liberado quando a Lixeira for esvaziada. Desmarque **Mover para a Lixeira** no rodapé para apagar permanentemente.
- **Lista de permissões** — só é possível apagar caminhos que apareceram no último scan **e** cujo nome é uma pasta de build conhecida.
- **Confirmação explícita** — a confirmação lista cada pasta e avisa quando há itens selecionados escondidos pelo filtro atual.
- **Ferramentas abertas** — avisa se Xcode, Android Studio ou daemons do Gradle estão rodando; o botão de encerrar envia `SIGTERM` apenas a daemons do seu usuário.
- **Scan contido** — não sai do volume da pasta escolhida (não entra em discos externos ou de rede) e pula pastas de sistema como `/System`, `/Volumes`, `/private` e `/usr`, a menos que você escolha uma delas como raiz.
- **Servidor local blindado** — escuta só em `127.0.0.1`, valida `Host`/`Origin` e exige em toda rota `/api/*` um token aleatório gerado a cada execução (se reiniciar o servidor, recarregue a aba).
- **Contador atômico** — gravado via arquivo temporário + rename; se `stats.json` estiver corrompido, uma cópia `stats.corrupt-<data>.json` é preservada.

## 🖥️ Compatibilidade

### Plataformas testadas

| Sistema | Versão | Node.js | Status |
|---|---|---|:---:|
| macOS (Apple Silicon) | — | — | ⏳ a confirmar |
| macOS (Intel) | — | — | ⏳ a confirmar |
| Linux (Ubuntu/Debian) | — | — | ⏳ a confirmar |
| Linux (Fedora/Arch) | — | — | ⏳ a confirmar |
| Windows 10/11 | — | — | ❌ não testado |
| WSL | — | — | ❌ não testado |

> ✅ testado e funcionando · ⚠️ funciona com limitações · ⏳ a confirmar · ❌ não testado
>
> Testou em outro sistema? Abra uma *issue* contando a versão do sistema e do Node.js.

### Recursos por sistema

| Recurso | macOS | Linux | Windows |
|---|:---:|:---:|:---:|
| Scan e exclusão | ✅ | ✅ | ⚠️ não testado |
| Mover para a Lixeira | ✅ | ✅ (`gio`) | ❌ |
| Seletor de pasta nativo | ✅ | ❌ (digite o caminho) | ❌ |
| DerivedData global | ✅ | — | — |
| Detecção de ferramentas abertas | ✅ | ✅ | ❌ |

## 🏗️ Estrutura

```
├── public/
│   └── index.html    # Interface (HTML/CSS/JS puro)
└── src/
    ├── server.js     # Servidor HTTP, API, segurança e contador
    ├── scanner.js    # Detecção de projetos e cálculo de tamanho
    └── system.js     # Processos abertos e integração com a Lixeira
```

## 🤝 Contribuindo

Contribuições são bem-vindas! Abra uma *issue* para discutir a ideia ou envie um *pull request*. Para adicionar uma nova plataforma, o ponto de partida é `src/scanner.js` (funções `detect*` e `*Artifacts`) e a lista `ARTIFACT_NAMES` em `src/server.js`.
