# BitHive

**Uma central local para sua frota Bitaxe.** Acompanhe hashrate, potência, temperatura e disponibilidade; compare aparelhos; mantenha histórico local; e configure pools e perfis manuais pelas APIs existentes do AxeOS.

[English](README.md)

O BitHive atende quem minera em casa com um ou mais aparelhos Bitaxe/ESP-Miner na própria rede. A prioridade inicial é o **Starminer Bitaxe 601 do proprietário, com AxeOS personalizado**, além do AxeOS oficial. Não é necessário instalar nem modificar firmware. A compatibilidade com o Starminer físico ainda precisa ser validada.

## Implementado na versão 0.1

- Cadastro por IPv4 privado ou nome de rede, com leitura de modelo, placa, firmware e MAC quando disponíveis.
- Comparação de hashrate, potência, eficiência em J/TH, temperatura do chip, estado e última atualização bem-sucedida.
- Totais reais excluem dados desatualizados e mineradores simulados. A eficiência usa potência e hashrate combinados somente dos aparelhos com ambos os dados.
- Histórico local de hashrate, potência e temperatura; shares aceitas/rejeitadas, erros, temperatura do regulador, atividade, rotação e melhor dificuldade quando informados.
- Coleta independente de abas do navegador, enquanto o servidor Node estiver ativo.
- Configuração da pool principal, conta/endereço de pagamento e worker, além de senha. Suporte aos campos antigos e ao slot principal ativo de firmware com múltiplas pools.
- Seleção de frequência e tensão entre as opções fornecidas pelo aparelho; refrigeração automática ou manual quando suportada.
- Perfis de operação nomeados, salvos por aparelho, e ações em lote para até 50 selecionados, com resultado individual.
- Interface em inglês e português brasileiro, idioma persistido, datas e números localizados.
- Demonstração com três mineradores simulados e configurações persistidas, sem mineração nem conexão com pools reais.
- Persistência SQLite de métricas, eventos, perfis e auditoria de alterações sem senhas.

### Planejado, ainda não implementado

Ajuste automático (há somente interfaces para estratégia e experimentos), experimentos persistidos e último perfil estável, agregação de histórico por todo o período, administração de pools alternativas, IPv6, portas HTTP personalizadas dos mineradores, descoberta de aparelhos, acesso remoto/autenticação, atualização de firmware, exclusão de perfis e remoção de mineradores. GIFs serão adicionados a `docs/media/` após gravação dos fluxos reais.

## Requisitos para macOS e Windows

- **Node.js 24 LTS** com npm. O arquivo `.nvmrc` está incluído para gerenciadores de versões.
- Git para clonar o repositório quando seu endereço for definido.
- Terminal no macOS ou PowerShell/Windows Terminal no Windows. Não é necessário Docker, servidor de banco, Prisma global ou utilitário de firmware.
- Mineradores acessíveis na mesma rede IPv4 privada para monitoramento real. Nomes `.local` dependem de resolução mDNS/Bonjour do sistema; usar o IP evita essa dependência.

A instalação inicial baixa dependências do npm. Depois, recursos da interface são servidos localmente e a execução normal não depende de CDNs nem de internet. A demonstração dispensa aparelhos físicos.

## Instalação e execução

O endereço do repositório ainda não foi escolhido. Quando estiver disponível, clone-o, entre na pasta `bithive` e execute:

```sh
npm ci
npm start
```

Abra **http://localhost:3080**. Mantenha o terminal aberto e encerre com Ctrl+C. Reiniciar preserva aparelhos, perfis, histórico e configurações da demonstração.

`npm ci` instala as versões travadas e gera o Prisma Client. `npm start` gera o cliente, aplica migrações versionadas com `prisma migrate deploy`, compila servidor e interface e inicia **um único servidor Node/Fastify** para ambos. O arquivo SQLite inicial é criado automaticamente, sem sobrescrever bancos existentes. A execução normal não usa `migrate dev`, não redefine o banco e não sincroniza o esquema de forma destrutiva.

O compilador e a ferramenta Prisma são dependências locais necessárias na inicialização. Não use `--omit=dev` nem desative scripts de instalação nesta distribuição. Falhas de compilação ou migração interrompem a inicialização.

### Primeiro uso

1. Clique em **Experimentar demonstração** para explorar três aparelhos simulados. Eles têm identificação explícita e ficam fora dos totais reais. Repetir a ação não cria duplicatas.
2. Use **Adicionar minerador**, informe um nome e um endereço como `192.168.1.42` ou `bitaxe.local`, sem protocolo, caminho ou porta. A identificação é consultada antes de concluir o cadastro.
3. Clique no nome do minerador para ver histórico, estatísticas, controles manuais, pool principal e auditoria. O histórico começa no cadastro; dados antigos do firmware não são importados.
4. Deixe campos vazios para manter seus valores. **Aplicar e verificar** envia uma alteração e relê o aparelho. Senhas nunca são exibidas nem persistidas pelo BitHive e não podem ser confirmadas por releitura.
5. Selecione várias linhas para ações em lote. As opções vêm do aparelho aberto; cada destino é validado separadamente, com falhas individuais para opções incompatíveis.
6. Dê um nome aos campos de operação escolhidos para salvar um perfil por aparelho. Carregar um perfil preenche o formulário; aplicar é uma ação separada. Perfis salvos não representam configurações certificadas como estáveis.

## Compatibilidade e interpretação dos resultados

As respostas dos mineradores são validadas durante a execução e as capacidades opcionais são detectadas. O adaptador usa informações do sistema, informações opcionais do ASIC e configuração de sistema da API oficial. Se o aparelho não informar opções válidas de frequência ou tensão, esses controles ficam somente para leitura. A coleta pode continuar com métricas parciais.

O AxeOS oficial é atendido pelo contrato de API revisado, incluindo campos antigos de pool principal e slots modernos. O Starminer 601 personalizado do proprietário é prioritário, mas **ainda não foi testado em hardware físico**. Nome de modelo ou versão não garante compatibilidade. Consulte [evidências da API e decisões de implementação](docs/IMPLEMENTATION.md), em inglês. Para relatar problemas, informe placa/modelo, versão, nomes de campos sem segredos e ação que falhou. Não publique senhas nem respostas integrais contendo credenciais.

Resultados distinguem **verificado**, **não verificado**, **resultado incerto** e **falhou**. A verificação confirma os valores públicos relatados pelo firmware; não comprova desempenho prolongado, estabilidade, segurança, pagamento ou ausência de necessidade de reinício. Alterações aceitas que não aparecem na releitura continuam não verificadas. Comandos com resultado incerto nunca são repetidos automaticamente. Verifique o estado no AxeOS antes de reenviar. Esta versão não reinicia o aparelho.

Em firmware com slots, apenas o principal ativo é atualizado, preservando seus campos validados e usando o marcador de preservação da senha do firmware quando ela fica vazia. Outros slots não são alterados. O BitHive não desativa proteções térmicas nem altera firmware. Campos legíveis são candidatos a configuração; o suporte real de escrita é confirmado pelo resultado e pela releitura.

## Arquitetura e coleta

React, TypeScript, Vite e i18next compõem a interface. Um servidor Fastify oferece a API e os arquivos compilados. Rotas, serviço da frota, adaptadores de aparelhos, coleta e persistência ficam separados. Prisma acessa o SQLite local. Tipos e cálculos compartilhados ficam em `src/shared`.

O serviço limita a concorrência a quatro aparelhos e serializa operações por minerador. A coleta normalmente ocorre a cada 15 segundos; falhas ampliam o intervalo até cinco minutos. Cada solicitação HTTP tem limite de cinco segundos e respostas têm tamanho limitado; uma leitura pode fazer duas solicitações. Ciclos não se sobrepõem e consultam até 100 aparelhos pendentes por vez. Há limite de 500 aparelhos cadastrados.

Uma falha torna os dados desatualizados; três falhas consecutivas marcam o aparelho desconectado. Leituras com mais de 90 segundos também ficam desatualizadas. Valores antigos continuam visíveis com sua data, mas não entram nos totais atuais. A coleta para com o servidor ou quando o computador dorme.

O servidor escuta somente `127.0.0.1`. Verificação de origem/Host e um cabeçalho especial protegem alterações feitas pelo navegador local. Não há contas nem acesso remoto. A comunicação usa HTTP na porta 80 em endereços IPv4 privados RFC1918; nomes são resolvidos, validados e o endereço é fixado por solicitação. Endereços de pools são enviados como configuração ao minerador; o BitHive não se conecta às pools.

## Dados, backup, migrações e atualizações

O padrão é **`data/bithive.db` dentro do projeto**. O diretório e arquivos auxiliares do SQLite ficam fora do Git. Senhas são enviadas ao aparelho e descartadas; a auditoria registra apenas que houve alteração de senha. O banco pode conter identificadores de conta e pagamento: proteja seus backups.

Nenhum arquivo de configuração é obrigatório. Variáveis opcionais:

| Variável | Padrão | Finalidade |
|---|---|---|
| `PORT` | `3080` | Porta do servidor de produção |
| `BITHIVE_DATA_DIR` | `<projeto>/data` | Diretório do banco SQLite |

Defina variáveis com a sintaxe normal do seu terminal antes de iniciar. Em desenvolvimento, mantenha a porta 3080 no servidor; a interface usa 5173.

Para backup, encerre com Ctrl+C e copie **todo o diretório de dados** para local protegido. Para restaurar, pare o aplicativo, substitua o diretório pelo backup e inicie normalmente. Não copie o banco em uso. Use `BITHIVE_DATA_DIR` fora do projeto se pretende substituir a pasta inteira do código.

Para atualizar: pare o servidor, faça backup, atualize o código, execute `npm ci` e `npm start`. Migrações versionadas são aplicadas na ordem, preservando os dados. Se falharem, investigue o erro sem redefinir o banco. Mudanças destrutivas futuras precisam de planejamento explícito.

A retenção roda na inicialização e aproximadamente a cada hora: métricas por **30 dias**, eventos por **90 dias**, auditorias de configuração por **365 dias**. Perfis e aparelhos não expiram. O histórico aceita de 1 a 720 horas e retorna as **1.000 amostras mais recentes** no período, além de até 100 eventos e 100 alterações. Um período longo pode mostrar apenas a parte recente. Lacunas e leituras ausentes interrompem as linhas dos gráficos.

## Desenvolvimento e testes

```sh
npm ci
npm run dev
```

Abra http://localhost:5173. O servidor e a coleta funcionam em 3080; Vite encaminha `/api`. As migrações versionadas também são aplicadas automaticamente em desenvolvimento.

```sh
npm test
npm run typecheck
npm run lint
npm run check:translations
npm run build
npx playwright install chromium
npm run test:e2e
```

Vitest cobre normalização, capacidades, cálculos, concorrência, demonstração, interface, falhas, migrações idempotentes, retenção, validação da API, resultados incertos, exclusão de senhas, perfis e coleta. Testes integrados usam bancos temporários isolados. Playwright inicia o servidor normal com dados isolados e verifica demonstração, detalhes, configuração, idioma persistido e layout móvel. Após instalar dependências e navegador, testes dispensam internet e aparelhos físicos.

Toda nova funcionalidade exige testes unitários significativos e aprovados. Use `npm run test:watch` durante o desenvolvimento. O GitHub Actions está configurado para macOS e Windows com Node 24; a execução hospedada ocorre após a publicação do repositório.

Ao alterar o esquema, use `npm run db:dev`, de preferência com diretório de dados isolado, e versione o esquema, SQL da migração e alterações no lockfile. `npm run db:migrate` aplica apenas migrações existentes. Consulte [CONTRIBUTING.md](CONTRIBUTING.md), em inglês.

## Solução de problemas

| Sintoma | Verificação |
|---|---|
| Versão incorreta do Node | Instale Node 24 LTS, reabra o terminal e repita `npm ci`. |
| npm indisponível na instalação | Verifique internet/proxy; recursos da execução normal não usam CDN. |
| Porta 3080 ocupada | Pare o outro processo ou defina `PORT` em produção. |
| Minerador não cadastra | Confirme IP privado, energia, rede e endpoint de informações do AxeOS; tente IP em vez de `.local`. |
| Campos diferentes no Starminer | Métricas ausentes são toleradas; opções desconhecidas permanecem somente para leitura. Informe modelo e versão sem segredos. |
| Alteração não verificada | Inspecione o AxeOS e aguarde o firmware estabilizar; timeout não prova que nada mudou. |
| Campo da ventoinha desativado | Selecione refrigeração manual; o firmware deve informar esse recurso. |
| Gráficos vazios | Deixe o servidor coletar pelo menos duas amostras e escolha período com dados. |
| Leituras desatualizadas | Verifique rede/energia e intervalo de recuperação; use atualização manual depois da reconexão. |
| Erro de migração | Confira escrita, espaço em disco e servidores duplicados. Preserve o backup e não redefina o banco. |
| Navegador de teste não abre | Execute `npx playwright install chromium` uma vez. |

## Contribuições, traduções, roadmap e licença

Leia [AGENTS.md](AGENTS.md) e [CONTRIBUTING.md](CONTRIBUTING.md). Textos ficam em `src/web/locales/en.json` e `pt-BR.json`. Atualize os dois idiomas, mantenha os nomes dos campos de interpolação e rode a verificação de cobertura. Não renderize HTML fornecido pelo aparelho. O roadmap está separado das funcionalidades implementadas acima.

O projeto está preparado para um repositório público de código aberto, mas **a licença e o endereço do repositório ainda não foram escolhidos**. `UNLICENSED` nos metadados indica essa pendência e não concede direitos de redistribuição. O proprietário deve selecionar uma licença antes da publicação. Esta implementação não cria nem publica um repositório no GitHub.
