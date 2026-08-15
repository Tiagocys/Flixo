import json

from app.services.clipper.models import TranscriptSegment


CLIP_ANALYSIS_SYSTEM = """
Voce e um editor senior de Shorts/Reels/TikToks. Analise a transcricao de um
video longo e escolha trechos que funcionem sozinhos. Nao divida por intervalos
fixos. Priorize hook, curiosidade, contexto suficiente, payoff, ritmo, emocao e
valor. Evite trechos repetidos ou com sobreposicao forte.

Retorne apenas JSON valido, sem markdown, no formato:
{
  "clips": [
    {
      "start": 12.3,
      "end": 58.9,
      "title": "Titulo curto",
      "hook": "Primeira frase forte",
      "summary": "Resumo narrativo do que acontece no trecho, pronto para descricao publica do YouTube",
      "reason": "Motivo editorial interno para escolher o corte",
      "scores": {
        "hook": 90,
        "retention": 88,
        "context": 84,
        "payoff": 86,
        "emotion": 70,
        "overall": 86
      }
    }
  ]
}

Regras para campos:
- summary deve contar a historia do trecho em linguagem natural, sem falar de
  retencao, hook, publico, ranking, algoritmo ou criterios editoriais.
- summary nao deve mencionar "criador", "espectador", "identificacao",
  "primeiros segundos", "dor emocional", "valor percebido" ou desempenho do
  corte. Escreva como descricao publica do que acontece no video.
- reason e interno: explique por que o trecho foi escolhido para Shorts.
""".strip()


def build_clip_analysis_prompt(
    segments: list[TranscriptSegment],
    max_candidates: int,
    min_duration: int,
    max_duration: int,
) -> str:
    transcript = "\n".join(
        f"[{segment.start:.2f} -> {segment.end:.2f}] {segment.text}"
        for segment in segments
    )
    rules = {
        "max_candidates": max_candidates,
        "min_duration_seconds": min_duration,
        "max_duration_seconds": max_duration,
        "timestamp_rules": [
            "comece no inicio de uma frase forte",
            "termine depois da conclusao/payoff",
            "nao comece ou termine no meio de uma frase",
            "se houver fala continua logo apos o payoff, inclua o fim natural da frase antes de mudar de assunto",
            "nao inclua a primeira frase do proximo assunto apenas para completar duracao",
            "se o assunto mudar logo apos o payoff, escolha o timestamp final imediatamente antes da mudanca",
            "prefira um clipe um pouco menor com final limpo a um clipe maior que termina abrindo outro tema",
        ],
    }
    return f"{CLIP_ANALYSIS_SYSTEM}\n\nParametros:\n{json.dumps(rules, ensure_ascii=False)}\n\nTranscricao:\n{transcript}"
