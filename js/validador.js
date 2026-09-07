/* ============================================================
   sistema-futbol — Validación interna obligatoria (§23)
   ------------------------------------------------------------
   Comprueba cualquier objeto contra el contrato del prompt maestro:
   estructura (§25, §26), identificadores (§27), rangos numéricos,
   etiquetas fijas de riesgo y valor, coherencia aritmética de cuota,
   probabilidad implícita y EV, y ausencia de textos prohibidos.

   Se usa dos veces: sobre el JSON que genera este sistema (autocontrol)
   y sobre el JSON que devuelva un modelo de lenguaje al que se le haya
   pasado PROMPT_MAESTRO.md.
   ============================================================ */

(function (global) {
  'use strict';

  const R = global.SFReglas;
  const esNum = v => typeof v === 'number' && isFinite(v);

  const RIESGOS = ['MUY_BAJO', 'BAJO', 'MEDIO', 'ALTO', 'MUY_ALTO'];
  const VALORES = ['POSITIVE', 'NEUTRAL', 'NEGATIVE', ''];
  const ESCENARIOS = ['ESCENARIO_LOCAL', 'ESCENARIO_EQUILIBRADO', 'ESCENARIO_VISITANTE'];

  const CLAVES_RAIZ = [
    'match', 'probabilities', 'goals', 'bothTeamsToScore', 'teamGoals', 'markets',
    'mostLikelyScores', 'scenarios', 'mainPrediction', 'alternativePrediction',
    'avoidMarket', 'keyFactors', 'dataQuality', 'conclusion'
  ];

  // §4 R2: nunca sustituir un vacío por un texto de relleno.
  const RELLENOS = ['n/a', 'na', 'nd', 'no disponible', 'desconocido', 'sin datos', 'null', 'undefined', '-'];

  // §32: el sistema no promete certezas.
  const CERTEZAS = ['100% seguro', 'apuesta segura', 'garantizado', 'garantizada', 'no puede perder', 'seguro al 100'];

  const TOL_SUMA = 0.011;    // §6: tolerancia de redondeo permitida
  const TOL_CALCULO = 0.005; // tolerancia para 1/cuota y para (p × cuota) - 1

  function crearResultado() {
    const res = { errores: [], advertencias: [] };
    res.error = (campo, mensaje) => res.errores.push({ campo: campo, mensaje: mensaje });
    res.aviso = (campo, mensaje) => res.advertencias.push({ campo: campo, mensaje: mensaje });
    return res;
  }

  function esObjeto(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  /* --- Comprobadores elementales --- */
  function probabilidad(res, obj, clave, ruta) {
    const v = obj ? obj[clave] : undefined;
    if (v === undefined) { res.error(ruta, 'Falta el campo.'); return; }
    if (v === null) return; // permitido: dato ausente (§4 R2)
    if (typeof v === 'string') { res.error(ruta, 'Es un string ("' + v + '"); debe ser un número decimal.'); return; }
    if (!esNum(v)) { res.error(ruta, 'No es un número finito.'); return; }
    if (v < 0 || v > 1) res.error(ruta, 'Fuera del rango 0–1: ' + v + '.');
  }

  function texto(res, obj, clave, ruta) {
    const v = obj ? obj[clave] : undefined;
    if (v === undefined) { res.error(ruta, 'Falta el campo.'); return; }
    if (typeof v !== 'string') { res.error(ruta, 'Debe ser un string (usa "" si no hay dato).'); return; }
    if (RELLENOS.indexOf(v.trim().toLowerCase()) !== -1) {
      res.error(ruta, 'Texto de relleno prohibido ("' + v + '"). Un texto ausente se representa con "".');
    }
  }

  function cuota(res, obj, ruta) {
    const v = obj.odds;
    if (v === undefined) { res.error(ruta + '.odds', 'Falta el campo.'); return; }
    if (v === null) return;
    if (typeof v === 'string') { res.error(ruta + '.odds', 'Es un string; la cuota debe ser un número.'); return; }
    if (!esNum(v)) { res.error(ruta + '.odds', 'No es un número finito.'); return; }
    if (v <= 1) res.error(ruta + '.odds', 'Una cuota decimal válida debe ser mayor que 1: ' + v + '.');
  }

  function confianza(res, obj, ruta) {
    const v = obj.confidence;
    if (v === undefined) { res.error(ruta + '.confidence', 'Falta el campo.'); return; }
    if (v === null) return;
    if (typeof v === 'string') { res.error(ruta + '.confidence', 'Es un string; debe ser un número entero.'); return; }
    if (!esNum(v)) { res.error(ruta + '.confidence', 'No es un número finito.'); return; }
    if (v < 0 || v > 100) res.error(ruta + '.confidence', 'Fuera del rango 0–100: ' + v + '.');
    else if (Math.round(v) !== v) res.aviso(ruta + '.confidence', 'Debería ser un entero: ' + v + '.');
  }

  function riesgo(res, obj, ruta, permitirVacio) {
    const v = obj.risk;
    if (v === undefined) { res.error(ruta + '.risk', 'Falta el campo.'); return; }
    if (typeof v !== 'string') { res.error(ruta + '.risk', 'Debe ser un string.'); return; }
    if (v === '' && permitirVacio) return;
    if (RIESGOS.indexOf(v) === -1) {
      res.error(ruta + '.risk', 'Etiqueta no permitida ("' + v + '"). Sólo: ' + RIESGOS.join(', ') + '.');
    }
  }

  function aritmeticaCuota(res, obj, ruta) {
    if (!esNum(obj.odds) || obj.odds <= 1) {
      if (esNum(obj.impliedProbability)) res.aviso(ruta + '.impliedProbability', 'Hay probabilidad implícita sin cuota válida.');
      if (esNum(obj.ev)) res.aviso(ruta + '.ev', 'Hay EV sin cuota válida.');
      return;
    }
    if (esNum(obj.impliedProbability)) {
      const esperado = 1 / obj.odds;
      if (Math.abs(obj.impliedProbability - esperado) > TOL_CALCULO) {
        res.error(ruta + '.impliedProbability', 'No coincide con 1 / cuota. Esperado ' + esperado.toFixed(4) + ', recibido ' + obj.impliedProbability + '.');
      }
    }
    if (esNum(obj.probability) && esNum(obj.ev)) {
      const esperado = obj.probability * obj.odds - 1;
      if (Math.abs(obj.ev - esperado) > TOL_CALCULO) {
        res.error(ruta + '.ev', 'No coincide con (probabilidad × cuota) - 1. Esperado ' + esperado.toFixed(4) + ', recibido ' + obj.ev + '.');
      }
    }
  }

  function idMercado(res, valor, ruta, permitirVacio) {
    if (typeof valor !== 'string') { res.error(ruta, 'Debe ser un string.'); return; }
    if (valor === '' && permitirVacio) return;
    if (R.IDS_MERCADO.indexOf(valor) === -1) {
      res.error(ruta, 'Identificador de mercado no reconocido ("' + valor + '"). Consulta la lista de §27.');
    }
  }

  function pronostico(res, obj, ruta) {
    if (!esObjeto(obj)) { res.error(ruta, 'Debe ser un objeto.'); return; }
    idMercado(res, obj.market, ruta + '.market', true);
    probabilidad(res, obj, 'probability', ruta + '.probability');
    probabilidad(res, obj, 'impliedProbability', ruta + '.impliedProbability');
    cuota(res, obj, ruta);
    if (obj.ev !== null && obj.ev !== undefined && !esNum(obj.ev)) {
      res.error(ruta + '.ev', 'El EV debe ser un número o null.');
    }
    riesgo(res, obj, ruta, true);
    confianza(res, obj, ruta);
    texto(res, obj, 'justification', ruta + '.justification');
    aritmeticaCuota(res, obj, ruta);
  }

  /* --- Barrido recursivo de textos prohibidos --- */
  function barrerTextos(res, valor, ruta) {
    if (typeof valor === 'string') {
      const bajo = valor.toLowerCase();
      CERTEZAS.forEach(function (frase) {
        if (bajo.indexOf(frase) !== -1) {
          res.error(ruta, 'Lenguaje de certeza prohibido (§32): "' + frase + '".');
        }
      });
    } else if (Array.isArray(valor)) {
      valor.forEach((v, i) => barrerTextos(res, v, ruta + '[' + i + ']'));
    } else if (esObjeto(valor)) {
      Object.keys(valor).forEach(k => barrerTextos(res, valor[k], ruta + '.' + k));
    }
  }

  /* --- Validación completa --- */
  function validar(data) {
    const res = crearResultado();

    if (!esObjeto(data)) {
      res.error('raiz', 'La respuesta debe ser un objeto JSON.');
      return terminar(res);
    }

    CLAVES_RAIZ.forEach(function (k) {
      if (!(k in data)) res.error(k, 'Falta la clave obligatoria de §25.');
    });

    // match
    if (esObjeto(data.match)) {
      ['homeTeam', 'awayTeam', 'competition', 'date'].forEach(k => texto(res, data.match, k, 'match.' + k));
    } else if ('match' in data) {
      res.error('match', 'Debe ser un objeto.');
    }

    // probabilities (§6)
    const P = data.probabilities;
    if (esObjeto(P)) {
      ['homeWin', 'draw', 'awayWin'].forEach(k => probabilidad(res, P, k, 'probabilities.' + k));
      if (esNum(P.homeWin) && esNum(P.draw) && esNum(P.awayWin)) {
        const suma = P.homeWin + P.draw + P.awayWin;
        if (Math.abs(suma - 1) > TOL_SUMA) {
          res.error('probabilities', 'LOCAL + EMPATE + VISITANTE debe sumar 1 (±0,01). Suma actual: ' + suma.toFixed(4) + '.');
        }
      }
    } else if ('probabilities' in data) {
      res.error('probabilities', 'Debe ser un objeto.');
    }

    // goals
    const G = data.goals;
    if (esObjeto(G)) {
      ['over0_5', 'over1_5', 'over2_5', 'over3_5', 'under1_5', 'under2_5', 'under3_5']
        .forEach(k => probabilidad(res, G, k, 'goals.' + k));

      [['over1_5', 'under1_5'], ['over2_5', 'under2_5'], ['over3_5', 'under3_5']].forEach(function (par) {
        if (esNum(G[par[0]]) && esNum(G[par[1]])) {
          const suma = G[par[0]] + G[par[1]];
          if (Math.abs(suma - 1) > TOL_SUMA) {
            res.error('goals.' + par[1], par[0] + ' + ' + par[1] + ' debe sumar 1. Suma actual: ' + suma.toFixed(4) + '.');
          }
        }
      });

      const escalera = ['over0_5', 'over1_5', 'over2_5', 'over3_5'];
      for (let i = 0; i < escalera.length - 1; i++) {
        const a = G[escalera[i]], b = G[escalera[i + 1]];
        if (esNum(a) && esNum(b) && b > a + 0.0001) {
          res.error('goals.' + escalera[i + 1], 'Incoherencia: ' + escalera[i + 1] + ' no puede superar a ' + escalera[i] + '.');
        }
      }
    } else if ('goals' in data) {
      res.error('goals', 'Debe ser un objeto.');
    }

    // bothTeamsToScore
    const B = data.bothTeamsToScore;
    if (esObjeto(B)) {
      probabilidad(res, B, 'yes', 'bothTeamsToScore.yes');
      probabilidad(res, B, 'no', 'bothTeamsToScore.no');
      if (esNum(B.yes) && esNum(B.no) && Math.abs(B.yes + B.no - 1) > TOL_SUMA) {
        res.error('bothTeamsToScore', 'Sí + No debe sumar 1. Suma actual: ' + (B.yes + B.no).toFixed(4) + '.');
      }
    } else if ('bothTeamsToScore' in data) {
      res.error('bothTeamsToScore', 'Debe ser un objeto.');
    }

    // teamGoals
    const T = data.teamGoals;
    if (esObjeto(T)) {
      ['homeOver0_5', 'homeOver1_5', 'awayOver0_5', 'awayOver1_5']
        .forEach(k => probabilidad(res, T, k, 'teamGoals.' + k));
      [['homeOver0_5', 'homeOver1_5'], ['awayOver0_5', 'awayOver1_5']].forEach(function (par) {
        if (esNum(T[par[0]]) && esNum(T[par[1]]) && T[par[1]] > T[par[0]] + 0.0001) {
          res.error('teamGoals.' + par[1], 'Incoherencia: ' + par[1] + ' no puede superar a ' + par[0] + '.');
        }
      });
    } else if ('teamGoals' in data) {
      res.error('teamGoals', 'Debe ser un objeto.');
    }

    // markets (§26)
    if (Array.isArray(data.markets)) {
      const vistos = {};
      data.markets.forEach(function (m, i) {
        const ruta = 'markets[' + i + ']';
        if (!esObjeto(m)) { res.error(ruta, 'Debe ser un objeto.'); return; }
        idMercado(res, m.market, ruta + '.market', false);
        if (typeof m.market === 'string' && m.market !== '') {
          if (vistos[m.market]) res.error(ruta + '.market', 'Mercado duplicado: ' + m.market + '.');
          vistos[m.market] = true;
        }
        probabilidad(res, m, 'probability', ruta + '.probability');
        probabilidad(res, m, 'impliedProbability', ruta + '.impliedProbability');
        cuota(res, m, ruta);
        if (m.ev !== null && m.ev !== undefined && !esNum(m.ev)) res.error(ruta + '.ev', 'El EV debe ser un número o null.');
        riesgo(res, m, ruta, true);
        confianza(res, m, ruta);
        if (typeof m.value !== 'string') res.error(ruta + '.value', 'Debe ser un string.');
        else if (VALORES.indexOf(m.value) === -1) {
          res.error(ruta + '.value', 'Valor no permitido ("' + m.value + '"). Sólo: POSITIVE, NEUTRAL, NEGATIVE o "".');
        }
        aritmeticaCuota(res, m, ruta);
      });
    } else if ('markets' in data) {
      res.error('markets', 'Debe ser un array.');
    }

    // mostLikelyScores (§17)
    if (Array.isArray(data.mostLikelyScores)) {
      if (data.mostLikelyScores.length > 3) {
        res.aviso('mostLikelyScores', 'Se esperan como máximo tres marcadores; hay ' + data.mostLikelyScores.length + '.');
      }
      data.mostLikelyScores.forEach(function (s, i) {
        const ruta = 'mostLikelyScores[' + i + ']';
        if (!esObjeto(s)) { res.error(ruta, 'Debe ser un objeto.'); return; }
        texto(res, s, 'score', ruta + '.score');
        if (typeof s.score === 'string' && s.score !== '' && !/^\d+-\d+$/.test(s.score)) {
          res.error(ruta + '.score', 'Formato de marcador no reconocido ("' + s.score + '"). Se espera "1-0".');
        }
        probabilidad(res, s, 'probability', ruta + '.probability');
      });
    } else if ('mostLikelyScores' in data) {
      res.error('mostLikelyScores', 'Debe ser un array.');
    }

    // scenarios (§18)
    if (Array.isArray(data.scenarios)) {
      if (data.scenarios.length !== 3) res.error('scenarios', 'Deben existir exactamente tres escenarios.');
      data.scenarios.forEach(function (s, i) {
        const ruta = 'scenarios[' + i + ']';
        if (!esObjeto(s)) { res.error(ruta, 'Debe ser un objeto.'); return; }
        if (ESCENARIOS.indexOf(s.id) === -1) {
          res.error(ruta + '.id', 'Identificador no permitido ("' + s.id + '"). Sólo: ' + ESCENARIOS.join(', ') + '.');
        } else if (ESCENARIOS[i] !== s.id) {
          res.aviso(ruta + '.id', 'Orden inesperado: se esperaba ' + ESCENARIOS[i] + '.');
        }
        probabilidad(res, s, 'probability', ruta + '.probability');
        texto(res, s, 'description', ruta + '.description');
      });
      const probs = data.scenarios.map(s => (esObjeto(s) ? s.probability : null)).filter(esNum);
      if (probs.length === 3) {
        const suma = probs.reduce((a, b) => a + b, 0);
        if (Math.abs(suma - 1) > TOL_SUMA) {
          res.aviso('scenarios', 'Los tres escenarios cubren el espacio de resultados y suelen sumar 1. Suma actual: ' + suma.toFixed(4) + '.');
        }
      }
    } else if ('scenarios' in data) {
      res.error('scenarios', 'Debe ser un array.');
    }

    // pronósticos (§20, §21)
    if ('mainPrediction' in data) pronostico(res, data.mainPrediction, 'mainPrediction');
    if ('alternativePrediction' in data) pronostico(res, data.alternativePrediction, 'alternativePrediction');
    if (esObjeto(data.mainPrediction) && esObjeto(data.alternativePrediction) &&
        data.mainPrediction.market && data.mainPrediction.market === data.alternativePrediction.market) {
      res.aviso('alternativePrediction.market', 'El pronóstico alternativo repite el mercado principal.');
    }

    // avoidMarket (§22)
    if (esObjeto(data.avoidMarket)) {
      idMercado(res, data.avoidMarket.market, 'avoidMarket.market', true);
      texto(res, data.avoidMarket, 'reason', 'avoidMarket.reason');
    } else if ('avoidMarket' in data) {
      res.error('avoidMarket', 'Debe ser un objeto.');
    }

    // keyFactors (§29)
    if (Array.isArray(data.keyFactors)) {
      data.keyFactors.forEach(function (f, i) {
        if (typeof f !== 'string') res.error('keyFactors[' + i + ']', 'Cada factor debe ser un string.');
        else if (RELLENOS.indexOf(f.trim().toLowerCase()) !== -1) {
          res.error('keyFactors[' + i + ']', 'Texto de relleno prohibido ("' + f + '").');
        }
      });
    } else if ('keyFactors' in data) {
      res.error('keyFactors', 'Debe ser un array de textos.');
    }

    // dataQuality (§28)
    if (esObjeto(data.dataQuality)) {
      const s = data.dataQuality.score;
      if (s === undefined) res.error('dataQuality.score', 'Falta el campo.');
      else if (s !== null) {
        if (typeof s === 'string') res.error('dataQuality.score', 'Es un string; debe ser un número.');
        else if (!esNum(s)) res.error('dataQuality.score', 'No es un número finito.');
        else if (s < 0 || s > 100) res.error('dataQuality.score', 'Fuera del rango 0–100: ' + s + '.');
      }
      texto(res, data.dataQuality, 'comment', 'dataQuality.comment');
    } else if ('dataQuality' in data) {
      res.error('dataQuality', 'Debe ser un objeto.');
    }

    // conclusion (§30)
    if ('conclusion' in data) {
      texto(res, data, 'conclusion', 'conclusion');
      if (typeof data.conclusion === 'string' && data.conclusion.indexOf('%') !== -1) {
        res.aviso('conclusion', 'La conclusión no debe llevar porcentajes incrustados; los valores ya viajan en sus campos numéricos.');
      }
    }

    barrerTextos(res, data, 'raiz');
    return terminar(res);
  }

  function terminar(res) {
    return {
      ok: res.errores.length === 0,
      errores: res.errores,
      advertencias: res.advertencias
    };
  }

  global.SFValidador = {
    validar: validar,
    RIESGOS: RIESGOS,
    VALORES: VALORES,
    ESCENARIOS: ESCENARIOS
  };
})(window);
