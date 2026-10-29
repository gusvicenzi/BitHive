# BitHive

**Uma central local para sua frota Bitaxe.** Acompanhe hashrate, potência, temperatura e disponibilidade; compare aparelhos; mantenha histórico local; e configure pools e perfis manuais pelas APIs existentes do AxeOS.

[English](README.md)

O BitHive atende quem minera em casa com um ou mais aparelhos Bitaxe/ESP-Miner na própria rede. A prioridade inicial é o **Starminer Bitaxe 601 do proprietário, com AxeOS personalizado**, além do AxeOS oficial. Não é necessário instalar nem modificar firmware. O monitoramento somente de leitura foi validado em hardware físico em 14/10/2026, com identificação GammaV2, placa 601a-4 e firmware V1.0.1-rc.10. O proprietário relatou alterações manuais de frequência, tensão e ventoinha funcionando em 14/10/2026; o ajuste automático e a restauração ainda exigem testes físicos supervisionados.

## Implementado na versão 0.1

- Cadastro por IPv4 privado ou nome de rede, usando automaticamente o nome do AxeOS, com leitura de modelo, placa, firmware e MAC quando disponíveis. Nome de exibição opcional no BitHive.
- Comparação de hashrate, potência, eficiência em J/TH, temperatura do chip, percentual de erros de hash, estado e última atualização bem-sucedida.
- Totais reais excluem dados desatualizados e mineradores simulados. A eficiência usa potência e hashrate combinados somente dos aparelhos com ambos os dados.
- Histórico local de hashrate, potência e temperatura, com escalas de unidades e dicas com valor/data ao passar o mouse, tocar ou usar o teclado; shares aceitas/rejeitadas, erros, temperatura do regulador, atividade, rotação e melhor dificuldade quando informados.
- Coleta independente de abas do navegador, enquanto o servidor Node estiver ativo.
- Configuração da pool principal, conta/endereço de pagamento e worker, além de senha. Suporte aos campos antigos e ao slot principal ativo de firmware com múltiplas pools.
- Seleção de frequência e tensão entre as opções fornecidas pelo aparelho, ou valores personalizados após confirmação de risco; refrigeração automática ou manual quando suportada.
- Perfis de operação nomeados, salvos por aparelho, e ações em lote para até 50 selecionados, com resultado individual.
- Interface em inglês e português brasileiro, idioma persistido, datas e números localizados.
- Demonstração com três mineradores simulados e configurações persistidas, sem mineração nem conexão com pools reais.
- Persistência SQLite de métricas, eventos, perfis e auditoria de alterações sem senhas.

### Planejado, ainda não implementado

agregação de histórico por todo o período, administração de pools alternativas, IPv6, portas HTTP personalizadas dos mineradores, descoberta de aparelhos, acesso remoto/autenticação, atualização de firmware, exclusão de perfis e remoção de mineradores. GIFs serão adicionados a `docs/media/` após gravação dos fluxos reais.

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
2. Use **Adicionar minerador**, informe um endereço como `192.168.1.42` ou `bitaxe.local`, sem protocolo, caminho ou porta. A identificação e o nome no AxeOS são consultados antes de concluir o cadastro. Deixe o nome de exibição opcional vazio para usar o nome do AxeOS; sem ele, usa-se modelo ou endereço.
3. Clique no nome do minerador para ver histórico, estatísticas, controles manuais, pool principal e auditoria. O histórico começa no cadastro; dados antigos do firmware não são importados.
4. Deixe campos vazios para manter seus valores. **Aplicar e verificar** envia uma alteração e relê o aparelho. Senhas nunca são exibidas nem persistidas pelo BitHive e não podem ser confirmadas por releitura.
5. Selecione várias linhas para ações em lote. As opções vêm do aparelho aberto; cada destino é validado separadamente, com falhas individuais para opções incompatíveis.
6. Informe um nome para salvar as configurações de operação atuais, incluindo alterações pendentes, em um perfil por aparelho. Carregar um perfil preenche o formulário; aplicar é uma ação separada. Perfis salvos não representam configurações certificadas como estáveis.

### Alteração dos nomes

Nos detalhes, use **Nomes do minerador**. **Nome de exibição no BitHive** altera somente o nome local, inclusive com o aparelho desconectado, e registra a edição no histórico. **Nome no AxeOS (hostname)** altera o aparelho por um único `PATCH /api/system`, seguido de releitura para verificar o resultado. Use de 1 a 63 letras, números ou hífens, começando e terminando com letra ou número. O valor é convertido para minúsculas; não inclua `.local`.

A mudança do hostname altera o nome de rede. Para aparelhos cadastrados por nome de rede, o BitHive resolve e valida o IPv4 privado antes do comando e mantém esse IP para verificação e coleta futura. A alteração é recusada se outro cadastro já usa o IP. Hostnames só podem ser alterados individualmente, sem combinar outras configurações ou selecionar vários mineradores. O controle fica indisponível quando o firmware não informa suporte. Resultados incertos são relatados e não são repetidos automaticamente.

Um nome de exibição igual ao hostname anterior acompanha alterações futuras do hostname. Nomes personalizados e nomes de cadastros existentes são preservados. Mineradores simulados aceitam alterações e as mantêm após reiniciar. Comandos de renomeação ainda não foram testados no Starminer físico; a validação física acima cobre somente leituras.

### Unidades dos gráficos e estimativa da fonte

Os gráficos de hashrate usam TH/s quando alguma leitura no histórico exibido supera 1.000 GH/s. Título, régua do eixo Y, dica e informações acessíveis usam a mesma unidade em todo o gráfico. Valores em TH/s mostram três casas decimais, como `1,712 TH/s`. Históricos com leituras de até 1.000 mantêm GH/s. Os dados continuam armazenados em GH/s. Dicas de potência e temperatura mostram exatamente uma casa decimal. A melhor dificuldade nos detalhes usa M/G/T com três casas decimais; passe o mouse, use foco ou toque para ver o número completo localizado. Se o firmware informar apenas um valor abreviado, a dica identifica sua expansão; não é possível recuperar a precisão omitida pelo firmware.

O cartão **Consumo de energia** normalmente mostra a potência informada pelos mineradores conectados. Ative **Incluir perdas da fonte** para ver potência informada + perda estimada da fonte = consumo estimado da tomada, com cores distintas para perda e total. A **Eficiência da fonte (%)** começa em **85%**, uma hipótese ajustável, não uma medição. O consumo estimado é a potência informada dividida pela eficiência / 100; a perda é a diferença. Com 85%, 56,7 W resulta aproximadamente em `56,7 + 10,0 = 66,7 W`. A eficiência deve ser maior que 0% e de no máximo 100%. Os valores exibidos são arredondados de forma consistente para que a soma confira.

Clique no total de watts da tomada para informar a leitura de um wattímetro para a frota online e selecione **Usar leitura** (ou pressione Enter). A eficiência da fonte é calculada como potência informada pelos mineradores / potência medida na tomada × 100. A leitura deve ser positiva e igual ou maior que a potência informada; a calibração exige potência dos mineradores maior que zero. O percentual calculado fica salvo e é usado em estimativas futuras conforme a potência muda.

Com as perdas da fonte ativadas, o cartão **Eficiência** da frota mostra J/TH na tomada, dividindo a eficiência dos mineradores com leituras combinadas pela fração de eficiência da fonte. Uma eficiência de fonte inválida deixa esse valor indisponível.

A estimativa usa uma única eficiência para a frota. Leituras ausentes ou desatualizadas são excluídas ou indicadas como parciais; simulações continuam fora dos totais reais. A opção não altera potência registrada, configuração, eficiência dos aparelhos nem gráficos históricos. A opção e a eficiência ficam salvas neste navegador; sem armazenamento disponível, funcionam na sessão atual.

## Compatibilidade e interpretação dos resultados

As respostas dos mineradores são validadas durante a execução e as capacidades opcionais são detectadas. O adaptador usa informações do sistema, informações opcionais do ASIC e configuração de sistema da API oficial. Se o aparelho não informar opções válidas de frequência ou tensão, esses controles ficam somente para leitura. A coleta pode continuar com métricas parciais.

O AxeOS oficial é atendido pelo contrato de API revisado, incluindo campos antigos de pool principal e slots modernos. O monitoramento e a detecção de capacidades foram **validados em um Starminer 601 físico** em 14/10/2026 (modelo informado GammaV2, placa 601a-4, firmware V1.0.1-rc.10), incluindo cadastro e persistência local das métricas. O proprietário relatou alterações manuais de frequência, tensão e ventoinha funcionando em 14/10/2026; o ajuste automático e a restauração ainda exigem testes físicos supervisionados. Nome de modelo ou versão não garante compatibilidade. Consulte [evidências da API e decisões de implementação](docs/IMPLEMENTATION.md), em inglês. Para relatar problemas, informe placa/modelo, versão, nomes de campos sem segredos e ação que falhou. Não publique senhas nem respostas integrais contendo credenciais.

Resultados distinguem **verificado**, **não verificado**, **resultado incerto** e **falhou**. A verificação confirma os valores públicos relatados pelo firmware; não comprova desempenho prolongado, estabilidade, segurança, pagamento ou ausência de necessidade de reinício. Alterações aceitas que não aparecem na releitura continuam não verificadas. Comandos com resultado incerto nunca são repetidos automaticamente. Verifique o estado no AxeOS antes de reenviar. Quando o firmware exigir, use Reiniciar miner após salvar as alterações.

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


## Ajuste automático (demonstração habilitada)

Abra os detalhes do minerador e **Ajuste automático**. O servidor controla o ajuste; fechar o navegador não o interrompe. Somente um minerador é ajustado por vez, enquanto o monitoramento da frota continua. Mantenha o servidor ligado, conectado e fora de suspensão: um computador indisponível não consegue recuperar o minerador.

Os limites de frequência e tensão são preenchidos com o mínimo e máximo das opções informadas pelo AxeOS; configurações atuais personalizadas não ampliam essas faixas. Sem opções disponíveis, os limites ficam vazios. Os padrões editáveis são passo de frequência de 25 MHz, passo de tensão de 10 mV, erro de hash máximo de 2%, limite ASIC de 65°C e limite VRM de 85°C. Revise os valores para cada aparelho antes de iniciar; são padrões do formulário, não limites de hardware validados. Escolha ventoinha automática pelo firmware ou porcentagem fixa. Os padrões são modo completo, estabilização de 120 segundos, medição de 300 segundos e tolerância de hashrate de 5%. A prévia mostra as extremidades reais (`mínimo + n × passo`) e uma estimativa conservadora da duração ativa máxima, incluindo alternativas de confirmação, gravações e recuperações limitadas. Pausas manuais e indisponibilidade do servidor não têm duração limitada. O hashrate esperado vem da telemetria compatível do firmware (GH/s convertido em TH/s) ou de uma referência em TH/s proporcional à frequência real. A origem fica registrada nos resultados.

O perfil original de frequência, tensão e ventoinha deve passar pela observação inicial antes da busca. Cada candidato é confirmado por leitura e monitorado a cada cinco segundos. As médias da medição são ponderadas pelo tempo e excluem a estabilização. J/TH é a potência média dividida pelo hashrate médio. Três erros consecutivos acima do limite, média final de erro acima do limite ou hashrate final abaixo da tolerância reprovam o candidato. Rejeições do pool são informativas, calculadas pela diferença dos contadores, e ficam indisponíveis sem shares submetidos. Reinício de contador invalida a medição.

A frequência sobe dentro de cada faixa de tensão; a tensão sobe entre faixas. Uma reprovação encerra a faixa e inicia recuperação confirmada do perfil estável, seguida de estabilização. O modo completo reinicia na frequência mínima; o rápido retesta a última frequência aprovada da faixa anterior, ou a mínima quando não houve aprovação. Os rankings usam desempates determinísticos por eficiência/hashrate, tensão e frequência. Cada vencedor provisório distinto exige nova estabilização e medição tripla; reprovações levam ao próximo candidato elegível. O modo rápido indica **melhor entre as configurações testadas**. Nenhum modo comprova um ótimo global ou estabilidade de longo prazo.

**Pausar** restaura o perfil original e preserva a posição; **Retomar** repete o candidato interrompido desde a estabilização. **Parar** restaura o original e encerra. A conclusão restaura o original; **Aplicar vencedor confirmado** exige uma ação explícita separada. Ajustes pausados mantêm a vaga exclusiva e bloqueiam configurações manuais até serem encerrados. Reinicialização do minerador, conexão perdida, telemetria ausente ou interrupção do monitoramento invalidam o candidato. A recuperação permite 120 segundos para reconectar e confirmar a restauração; a estabilização do perfil recuperado é separada. Mudanças externas de configuração ou firmware pausam para revisão. Limites térmicos e falhas de hardware/proteção encerram a busca; a recuperação nunca aumenta a tensão após uma parada de segurança nem desativa proteções. **Recuperação necessária** aparece com destaque e mantém o controle exclusivo quando não há confirmação. Ao reiniciar o servidor, a tentativa interrompida é invalidada, a restauração original é tentada e o ajuste pausa para retomada manual. Comandos de candidatos incertos nunca são repetidos automaticamente.

Configurações imutáveis, ajustes, tentativas, amostras, perfis originais/estáveis, prazos e vínculos com auditoria persistem em SQLite por migrações versionadas. Resultados e resumos sobrevivem à retenção comum de métricas. As APIs por aparelho são `/api/devices/:id/tuning` (GET lista / POST `{requestKey, config}`), `/:runId` (progresso), `/:runId/results?offset=0&limit=100` (máximo 200), `/:runId/pause`, `/resume`, `/stop` (POST `{}`) e `/:runId/apply` (POST `{category: "hashrate" | "efficiency"}`). Inícios são idempotentes por aparelho/chave; reutilizar a chave com outra configuração retorna conflito.

O ajuste automático físico exige confirmação para cada execução. Ative a opção em Ajuste automático após verificar alterações manuais de frequência, tensão e ventoinha no minerador selecionado e revisar seus limites. O proprietário relatou gravações manuais funcionando em 14/10/2026; as buscas automáticas e a restauração foram testadas com transporte simulado, sem validação independente em hardware físico. A confirmação fica salva com a execução do aparelho e autoriza gravações em segundo plano e recuperação após reiniciar o servidor. Cada nova execução exige nova confirmação; suporte do adaptador sozinho não libera gravações. Telemetria ou capacidades obrigatórias ausentes bloqueiam o início. Candidatos e vencedores devem corresponder à grade e à política de ventoinha configuradas; a recuperação só aceita o perfil original ou estável salvo. Mudanças de firmware bloqueiam todas as gravações físicas, inclusive restauração, podendo exigir recuperação manual. As proteções continuam ativas; nenhuma opção de OC ou proteção é alterada. Os campos foram conferidos na [OpenAPI do ESP-Miner](https://github.com/bitaxeorg/ESP-Miner/blob/master/main/http_server/openapi.yaml) e na [implementação de telemetria](https://github.com/bitaxeorg/ESP-Miner/blob/master/main/http_server/system_api_json.c). Os testes usam mineradores simulados/de demonstração e bancos temporários, sem acesso a mineradores físicos.

Valores manuais personalizados: em Configuração, ative a confirmação de risco para substituir as opções de frequência/tensão por campos inteiros em MHz/mV. Campos vazios mantêm os valores atuais. Desativar a opção descarta alterações personalizadas; carregar um perfil personalizado exige nova confirmação. Cada solicitação inclui sua própria confirmação, registrada na auditoria e nunca enviada ao AxeOS. O intervalo de representação da API (1–65535) não é uma faixa segura de operação. As verificações de capacidade, a serialização e a leitura de confirmação continuam ativas. A opção não altera o modo OC, as proteções do firmware nem libera o ajuste automático físico. O proprietário relatou gravações manuais funcionando; isso não constitui validação independente de buscas automáticas e recuperação.

Quando `actualFrequency` não está disponível, Iniciar ajuste informa esse campo e oferece um botão separado para confirmar o uso da frequência configurada na execução. Confirmar não inicia o ajuste; revise os limites e clique em Iniciar ajuste novamente. A escolha fica salva para candidatos, cálculo de hashrate esperado por referência, confirmação, retomada e recuperação após reiniciar o servidor. As amostras registram frequência e origem; a execução selecionada exibe um aviso. A frequência configurada não confirma de forma independente o clock aplicado ao ASIC nem permite detectar rampas ou redução do clock pela `actualFrequency`. Temperaturas, potência, hashrate, erros, uptime ou hashrate esperado obrigatório ausentes continuam bloqueando o ajuste. O ESP-Miner upstream expõe `actualFrequency` na [implementação da API](https://github.com/bitaxeorg/ESP-Miner/blob/master/main/http_server/system_api_json.c); os aparelhos V1.0.1-rc.10 do proprietário omitem esse campo.

## Perfis de pool

Abra **Perfis de pool** no menu lateral para criar um perfil ou copiar a última configuração coletada de uma Bitaxe. Os perfis são compartilhados pela frota, persistem após reiniciar e podem ser editados ou excluídos (até 100 perfis). Salve endereço, porta e usuário; senhas não são armazenadas.

Na configuração de um miner, em **Pool e pagamentos**, escolha **Carregar perfil de pool**, revise o worker e informe a senha, se necessário. Clique em **Aplicar e verificar**. Selecionar, copiar, salvar ou excluir um perfil não altera os miners. Após cadastrar um novo miner, seus detalhes são abertos para facilitar a configuração. Os perfis operacionais continuam separados por dispositivo.

### Perfis no pool principal e no fallback

Em **Perfis de pool**, escolha **Pool para copiar → Pool principal / Pool de fallback** e selecione uma Bitaxe. O perfil salvo pode ser usado em qualquer um dos destinos. Na configuração do miner, use **Carregar perfil de pool** para o principal ou **Carregar perfil no fallback** para o reserva. Revise o worker e a senha e clique em **Aplicar e verificar**. Senhas não são salvas nos perfis.

O fallback funciona com os campos antigos da API ou com um slot secundário distinto informado pelo firmware. Quando indisponível ou ambíguo, os controles ficam desabilitados. A aplicação preserva o pool principal quando apenas o fallback é alterado; não muda índices de slots, não força fallback nem troca o pool ativo. A verificação confirma a configuração lida, não testa uma falha real do pool. A escrita de fallback no firmware Starminer personalizado ainda requer validação física independente; os testes de desenvolvimento usam fixtures e miners simulados.

### Edições e reinicialização do miner

Os campos da configuração mostram os valores da última leitura. Uma borda âmbar e a contagem de campos não salvos indicam edições. Reverter um valor remove a marcação; **Descartar edições** restaura a leitura atual. Atualizações em segundo plano preservam as edições e atualizam campos intocados. Senhas ficam vazias porque o AxeOS não as retorna; deixar a senha vazia preserva a atual.

**Aplicar e verificar** envia os valores editados e confere a leitura. Quando o firmware exigir uma reinicialização para ativar os ajustes salvos, use **Reiniciar miner** na configuração do dispositivo aberto. Salve ou descarte edições primeiro. A reinicialização interrompe brevemente a mineração, é bloqueada durante um ajuste automático ativo e tem intervalo de 30 segundos entre solicitações. O recebimento do comando não confirma a conclusão; o BitHive só informa uma reinicialização observada após ler um tempo de atividade menor. Comandos com resultado desconhecido não são repetidos automaticamente.

A compatibilidade de reinicialização com o firmware Starminer personalizado ainda exige validação física independente. Os testes de desenvolvimento usam fixtures e miners simulados.

### Workers nos perfis de pool

Os perfis salvam **Endereço de pagamento / conta (sem worker)**. Ao copiar o pool principal ou de fallback de uma Bitaxe, o sufixo após o último ponto é removido; revise a conta, especialmente quando ela contém pontos. Contas com pontos digitadas no novo campo são preservadas nos próximos salvamentos.

Ao carregar o perfil, o worker vem do hostname informado pelo AxeOS, em minúsculas e sem espaços: `Living Room AXE` vira `livingroomaxe`, gerando `conta.livingroomaxe`. O usuário gerado fica somente para leitura enquanto o perfil estiver selecionado. Limpe a seleção do perfil para editar o usuário manualmente. O nome de exibição local do BitHive não é usado; sem hostname no AxeOS, o carregamento do perfil fica bloqueado.

Em lotes, o usuário de cada miner é gerado a partir de uma leitura atual do AxeOS, dentro do fluxo de configuração serializado. O worker do miner aberto não é copiado aos demais. A mesma regra vale para o pool principal e o fallback. Miners sem hostname são rejeitados individualmente, sem gravação.

Perfis antigos são lidos sem o último sufixo de worker, preservando os dados armazenados até um novo salvamento no formato de conta sem worker. Não há migração do banco nem reconfiguração automática dos miners.

A Frota reúne os painéis da frota e a configuração em lote. Abra um minerador para acessar seu painel e controles; configuração e ajuste automático começam fechados e carregam sob demanda. Em Atividade, escolha minerador, categoria e período, com 20 registros por página. Os gráficos começam com uma hora e uma métrica.

Reordene Seus mineradores pela alça ao lado de cada linha (arraste, toque ou use as setas para cima/baixo com a alça em foco). A ordem é salva neste navegador e mantida nas atualizações da frota e ao recarregar. Com filtro de status ativo, os mineradores ocultos mantêm suas posições.

Os detalhes mostram primeiro status, hashrate (incluindo médias do firmware), potência, eficiência, temperaturas do chip/VRM e erros de hash; tensão de entrada e última atualização vêm em seguida com os dados de hardware. As cores interpolam entre referências visuais: chip 40/55/65/75°C e VRM 45/65/85/105°C (baixa/média/alta/perigo). Os pontos de perigo usam como referência THROTTLE_TEMP e TPS546_THROTTLE_TEMP do ESP-Miner em `main/tasks/power_management_task.c`; os pontos intermediários são escolhas visuais, não limites informados pelo firmware. Variantes podem diferir. Nenhuma proteção ou ajuste do minerador é alterado. Temperaturas ausentes/negativas ficam neutras; leituras desatualizadas usam cores suaves e borda tracejada.

Os detalhes mostram a porcentagem atual da ventoinha (`fanspeed`, 0–100%) junto com o RPM. O valor vem da telemetria do firmware, inclusive em modo automático; a configuração manual salva nunca é usada como substituta. Leituras ausentes ou inválidas mostram “—”.

### Grupos de pool e histórico da frota

A página Frota agrupa miners por endereço do pool, porta e conta de pagamento, sem o sufixo do worker. Perfis salvos correspondentes dão nome ao grupo; endereços sem perfil, incluindo pools solo locais, também formam grupos. Expanda ou recolha cada grupo para ver miners, hashrate, potência e quantidade online. **Todos os miners** restaura a lista única para reordenar entre grupos. Selecionar um grupo preserva seleções feitas em outros.

O pool em uso é obtido de `isUsingFallbackStratum`, inclusive nos slots principal e secundário informados. Quando o firmware não informa a seleção ou a leitura está desatualizada/offline, o grupo indica configuração/última leitura e pool ativo não confirmado. O modo de mineração não é deduzido do nome do host, porta, nome do perfil ou marca do firmware.

**Histórico da frota** oferece última hora, dia e semana: soma de hashrate e potência informada pelos dispositivos, além de linhas de temperatura do chip e VRM com cores consistentes por miner. Use mouse, toque ou setas para inspecionar amostras. A legenda mostra/oculta o miner nos dois gráficos de temperatura sem alterar os totais. Históricos reais e simulados ficam separados. Os totais somam médias disponíveis por intervalo e o tooltip informa quantos miners contribuíram. Intervalos ausentes permanecem como lacunas. No histórico individual, selecione **Temperatura do VRM** em **Métrica do gráfico**.
