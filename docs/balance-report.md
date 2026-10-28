# Relatório de balanceamento

Gerado com `node tools/simulate.js --games 14 --maxwave 40 --seed 4000 --diff easy,normal,hard` (14 partidas por linha).
"VENCE" = % das partidas que derrotaram a **wave de vitória** (Fácil 15 · Normal 20 · Difícil 25).

## O que mudou (v4)

1. **Vitória**: o jogo era infinito, então não dava para "ganhar". Agora a vitória é derrotar a wave
   `BALANCE.victoryWave` (Fácil 15, Normal 20, Difícil 25). A tela de Vitória deixa **continuar no modo infinito**.
2. **Duas alavancas novas por dificuldade** (em `BALANCE.difficulty`):
   - `late`: escala só o termo *quadrático* do nº de inimigos e do HP, ou seja, o crescimento das waves finais
     (o começo do jogo fica igual). Era 1 em todas; agora Fácil 0.7, Normal 0.78, Difícil 0.5.
   - `goma`: goma extra no fim de cada wave. Fácil agora dá +3 (Normal e Difícil, 0).
3. **Bots que imitam um jogador humano**: os bots com plano chegavam à wave 21–28 no Fácil, mas o jogador real
   morria por volta da wave 15, então eles não serviam de régua. Foram criados `casual` (escolhe sempre o 1º power-up
   e nunca usa a loja) e `casual2` (igual, mas usa a loja). No Fácil antigo o `casual2` morria em média na wave 15,9,
   o que bate com o relato do jogador, e passou a ser a régua do Fácil.

## Resultado atual

| dificuldade | estratégia | mediana | média | p10 | p90 | VENCE |
|---|---|---|---|---|---|---|
| easy | naive (iniciante) | 14 | 14.3 | 12 | 16 | 36% |
| easy | casual | 14 | 13.3 | 12 | 16 | 14% |
| easy | casual2 (régua do jogador) | 16 | 15.9 | 16 | 16 | 93% |
| easy | spam | 16 | 16 | 16 | 16 | 100% |
| easy | balanced | 16 | 16 | 16 | 16 | 100% |
| easy | eco | 16 | 16 | 16 | 16 | 100% |
| easy | tank | 16 | 15.6 | 16 | 16 | 93% |
| normal | naive | 12 | 10.6 | 6 | 17 | 0% |
| normal | casual | 9 | 8.7 | 6 | 12 | 0% |
| normal | casual2 | 12 | 12 | 7 | 14 | 0% |
| normal | spam | 19 | 16.4 | 8 | 21 | 29% |
| normal | balanced | 21 | 18.9 | 14 | 21 | 79% |
| normal | eco | 21 | 17.4 | 1 | 21 | 64% |
| normal | tank | 21 | 17 | 1 | 21 | 57% |
| hard | naive | 12 | 10.1 | 6 | 14 | 0% |
| hard | casual | 6 | 8.3 | 6 | 12 | 0% |
| hard | casual2 | 14 | 12.6 | 5 | 22 | 0% |
| hard | spam | 20 | 18.4 | 14 | 23 | 7% |
| hard | balanced | 18 | 15.1 | 1 | 26 | 21% |
| hard | eco | 18 | 13.1 | 1 | 26 | 21% |
| hard | tank | 10 | 10.9 | 1 | 24 | 7% |

Quando a partida é vencida, a coluna "wave" mostra a wave de vitória + 1 (ex.: 16 no Fácil).

## Como ler

- **Fácil**: quem joga como o jogador real (`casual2`) vence ~9 em 10, o iniciante cerca de 1 em 3 e o casual mais
  descuidado perto de 1 em 7. O jogador que só chegava à wave 15 passa a ter chance real de vencer.
- **Normal**: quem planeja bem vence (57–79%); quem joga no automático não passa da wave 12.
- **Difícil**: só estratégias boas vencem, e raramente (~1 em 5 no melhor caso). Se achar impossível, baixe
  `victoryWave.hard` ou o `late` do Difícil.
- Os bots são aproximações: comparam versões e acham problemas grosseiros, mas não prevêem exatamente um humano.
- Ao mexer nos números use `--set`, ex.: `--set difficulty.easy.late=0.65 --set difficulty.easy.goma=2`.
  Cuidado: o muro da wave 15 (boss) é um degrau íngreme, pequenas mudanças no `late` mexem muito na taxa de vitória.
