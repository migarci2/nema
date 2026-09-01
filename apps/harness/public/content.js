/**
 * nema: Saucier School content and graders.
 *
 * This module is imported by the browser page AND by the Cloudflare Worker, so
 * it is fully self contained: no imports, no DOM access, no globals beyond the
 * ES language itself. Everything here is pure data plus pure functions.
 *
 * Exports
 *   MANIFEST            LearningManifest (CONTRACT 5.1), unsigned.
 *   ACTIVITIES          { [activityId]: Activity } in path order.
 *   grade(id, sub)      -> { result, score, feedback: string[], claims: [] }
 *   CONTENT_HASH_INPUT  JSON.stringify(ACTIVITIES); the worker hashes this
 *                       into receipt.activity.contentHash.
 *   personalizePath(st) -> { path, skipped, fullMinutes, personalMinutes }
 *
 * ---------------------------------------------------------------------------
 * ACTIVITY SHAPE (read this before building the UI)
 * ---------------------------------------------------------------------------
 * Every activity has the same envelope:
 *
 *   { id, version, title, type, minutes, difficulty, grader,
 *     evidenceProduced, outcomes: [{concept, ability}],
 *     skipIf: [{concept, ability, status}], onlyIf?: [...],
 *     includeReason, skipReason, notApplicableReason?,
 *     whatTheLearnerDoes, content: <type specific> }
 *
 * content, by type:
 *
 * lesson
 *   { intro: string,
 *     sections: [{ heading: string, html: string }],
 *     keyPoints: string[],
 *     exposureClaim: { concept, ability: 'recognize', evidenceType: 'recognition' } }
 *   Submission: { completed: true }. A completed lesson produces one exposure
 *   receipt (grader weight 0.1). Reading is not mastery, and the receipt says so.
 *
 * diagnostic
 *   { prompt: string,
 *     context: { html: string },
 *     options: [{ id, html, whyWrong }],   // whyWrong is '' for the answer key
 *     answerKey: string,                    // option id
 *     explanation: string,
 *     hints: string[] }
 *   Submission: { optionId: string, hintsUsed?: number }.
 *   Reveal option.whyWrong and explanation only AFTER submission.
 *   Grading: the answer key is 'passed', anything else is 'failed'. Hints do
 *   not change the result. hintsUsed travels to the vault in the receipt
 *   conditions instead, because the vault owns the weighting of evidence and
 *   the provider should not grade the same fact twice.
 *
 * interactive-lab
 *   { scenario: { html: string },
 *     brokenHarness: { json: object },      // the method card as it was cooked,
 *                                           // render as pretty printed JSON
 *     beforeRun: string[],                  // pass and tasting notes, as-is
 *     checks: [{ id, label, detail, kind: 'required'|'harmful'|'neutral' }],
 *     stages: [{ id, label }],              // learner drags these into order
 *     afterRun: string[],                   // notes from the remake, after a pass
 *     hints: string[],
 *     answerKey: { requiredChecks: [id], harmfulChecks: [id], stageOrder: [id] } }
 *   Submission: { checks: [id], stageOrder: [id] }.
 *   Neutral checks are free: selecting them never hurts, ignoring them never hurts.
 *   Grading: 'passed' when all required checks are selected, no harmful check is
 *   selected and the stage order is exact; 'partial' when the checks are right
 *   but the order is not; 'failed' otherwise.
 *
 * free-recall
 *   { prompt: string,
 *     rubric: [{ id, criterion, keywords: string[] }],
 *     minWords: number }
 *   Submission: { text: string }.
 *   Grading (grader 'provider-rubric', weight 0.8): a criterion is met when any
 *   of its keywords appears in the text, case insensitive, at the start of a
 *   word. The trailing boundary is deliberately open so that inflections count:
 *   the stem 'droplet' matches "droplets", 'emulsif' matches "emulsifier",
 *   "emulsify" and "emulsified". Substrings that start inside another word never
 *   count, so "preheat" is not a match for 'heat'.
 *   All criteria met is 'passed', one short of all is 'partial', otherwise
 *   'failed'. Answers under minWords cannot pass: they are graded 'failed'
 *   with an explicit message.
 *
 * ---------------------------------------------------------------------------
 * MINUTES ARITHMETIC (the 68 -> 27 -> 21 story)
 * ---------------------------------------------------------------------------
 *   1 heat-control-primer      12   skipIf heat-control.explain verified
 *   2 knife-skills-refresher   15   skipIf knife-skills.apply verified
 *   3 ratios-diagnostic         6   onlyIf ratios.apply uncertain
 *   4 ratios-primer            14   skipIf ratios.apply uncertain (or better)
 *   5 pan-sauce-anatomy         4   always
 *   6 fix-the-broken-sauce     12   always
 *   7 explain-without-the-recipe 5  always
 *
 *   Full path (all seven):        12+15+6+14+4+12+5 = 68  = unit.estimatedMinutes
 *   Seed learner (knife-skills verified, heat-control verified,
 *   ratios uncertain):            6+4+12+5          = 27
 *   After the diagnostic passes (ratios verified):
 *                                 4+12+5            = 21
 *   No assertion presented yet
 *   (personalizePath(null)):      the whole offer   = 68
 *   Every requirement missing:    12+15+14+4+12+5   = 62
 *     (the diagnostic drops out: onlyIf matches a status exactly, and a cook
 *      with no evidence at all for ratios is sent straight to the primer, which
 *      is the cheaper thing to do for them.)
 *
 *   So 68 is the offer, not a personalized result: 62 is the longest path any
 *   real assertion can produce.
 */

/* ------------------------------------------------------------------ */
/* Manifest                                                            */
/* ------------------------------------------------------------------ */

const PROVIDER_ORIGIN = 'https://saucier.migarci2.dev';

/* ------------------------------------------------------------------ */
/* Activities                                                          */
/* ------------------------------------------------------------------ */

export const ACTIVITIES = {
  'heat-control-primer': {
    id: 'heat-control-primer',
    version: '1.0.0',
    title: 'Heat is a rate, not a setting',
    type: 'lesson',
    minutes: 12,
    difficulty: 'introductory',
    grader: 'exposure',
    evidenceProduced: 'recognition',
    outcomes: [{ concept: 'nema:heat-control', ability: 'recognize' }],
    skipIf: [{ concept: 'nema:heat-control', ability: 'explain', status: 'verified' }],
    includeReason: 'Included: no verified evidence that you can explain heat control.',
    skipReason: 'Skipped: your vault already proves you can explain heat control.',
    whatTheLearnerDoes: 'Reads three short sections and marks the lesson complete.',
    content: {
      intro:
        'A burner dial is not a temperature. It is a rate at which energy enters the pan, and what the food experiences depends on the metal, the mass, the fat and how much cold protein you just dropped in. Cooks who control heat are not guessing better. They are reading the pan.',
      sections: [
        {
          heading: 'The pan is the thermostat',
          html:
            '<p>Turn a burner to high and the flame is instant. The pan is not. A 3 mm carbon steel or cast iron pan stores energy and gives it back slowly, so it holds temperature when food arrives. A thin stainless pan holds almost nothing: put six cold chicken thighs into it and the cooking surface falls 40 to 60 C in seconds.</p>' +
            '<p>Preheat, then test: a drop of water flicked into a dry stainless pan over medium heat should ball up and skate across the surface rather than hiss and vanish. That is the Leidenfrost point, somewhere near 180 C, and it is the moment to add the oil. Then respect the mass you have: crowd the pan and every piece releases water, the surface drops under 100 C, and you are steaming meat in its own juices with no way back.</p>'
        },
        {
          heading: 'The wall at 100 C, and the fat that carries you past it',
          html:
            '<p>Wet food cannot exceed 100 C while it is still wet. Water boiling off holds the surface there, which is why a damp steak greys instead of browning. Blot it and salt it ahead so the surface dries.</p>' +
            '<p>Browning is two reactions with two thresholds. Maillard, between amino acids and reducing sugars, runs usefully from about 140 C. Caramelization is sugar breaking down alone and needs roughly 160 to 170 C for sucrose. Both need a dry surface first.</p>' +
            '<p>Fat is what moves that heat into the food evenly, and each fat has a ceiling. Refined neutral oil holds to about 230 C, clarified butter to roughly 250 C because the milk solids are gone, and whole butter browns at about 150 C and burns shortly after. That is exactly why you sear in oil and finish with butter.</p>'
        },
        {
          heading: 'Hotter is not faster',
          html:
            '<p>The most expensive belief in a kitchen is that more flame means less time. A ripping pan browns the outside of a thick chop in 90 seconds and leaves the middle at 40 C. Heat travels through meat at a rate the protein sets, not the burner. Sear hard, then drop to moderate heat or move to a 150 C oven and let the centre climb. Pull it 5 C under target, because carryover keeps cooking.</p>' +
            '<p>Listen while you work. A hard, spitting sizzle is water leaving. A lower, drier crackle means the surface has dried and is browning. Silence with rising smoke means the fond is about to go from mahogany to bitter black: less flame and a splash of water, immediately.</p>' +
            '<p>Sauces live at the other end of the scale. A butter emulsion holds between roughly 60 and 85 C and splits above about 90 C. So the last five minutes of a pan sauce are a heat control problem, not a recipe problem.</p>'
        }
      ],
      keyPoints: [
        'Heat is a rate of energy entering the food. The pan mass, not the dial, decides what the food feels.',
        'Wet surfaces are stuck at 100 C. Dry the surface before you expect any browning.',
        'Maillard from about 140 C, caramelization near 160 to 170 C, whole butter burns just past 150 C.',
        'Hotter is not faster: a hard sear plus moderate finishing heat beats full flame throughout.',
        'Butter emulsions hold between about 60 and 85 C and break above 90 C.'
      ],
      exposureClaim: {
        concept: 'nema:heat-control',
        ability: 'recognize',
        evidenceType: 'recognition'
      }
    }
  },

  'knife-skills-refresher': {
    id: 'knife-skills-refresher',
    version: '1.0.0',
    title: 'Knife skills, refreshed for the saucier station',
    type: 'lesson',
    minutes: 15,
    difficulty: 'introductory',
    grader: 'exposure',
    evidenceProduced: 'recognition',
    outcomes: [{ concept: 'nema:knife-skills', ability: 'recognize' }],
    skipIf: [{ concept: 'nema:knife-skills', ability: 'apply', status: 'verified' }],
    includeReason: 'Included: no verified evidence that you can apply knife skills.',
    skipReason: 'Skipped: your vault already proves you can apply knife skills.',
    whatTheLearnerDoes: 'Reads three short sections and marks the lesson complete.',
    content: {
      intro:
        'You can already chop an onion. This refresher is about why a saucier cares how evenly you did it, because a pan sauce gives your shallots about 45 seconds before the pan takes them past sweet and into bitter.',
      sections: [
        {
          heading: 'Grip, guide hand, board',
          html:
            '<p>Take a pinch grip: thumb and forefinger on the flat of the blade just ahead of the bolster, the other three fingers wrapped around the handle. The knife stops being a stick you push and becomes an extension of the forearm, and it stops twisting on contact.</p>' +
            '<p>The other hand does more work than the knife hand. Curl it into a claw, fingertips tucked back behind the knuckles, and let the flat of the blade ride against those knuckles. The knuckle sets the thickness of every slice, so a steady claw is what makes cuts uniform. Feed the food forward with the fingertips, in small steps.</p>' +
            '<p>Put a damp cloth or a piece of wet paper towel under the board. A board that slides is the most common cause of a cut hand in a domestic kitchen. Use wood or polyethylene, never glass, marble or steel: those flatten an edge in a single session.</p>'
        },
        {
          heading: 'The cuts have dimensions, and the dimensions have a reason',
          html:
            '<p>Classical cuts are a shared vocabulary with numbers attached.</p>' +
            '<ul>' +
            '<li><b>Julienne</b> 3 mm by 3 mm by 50 mm. <b>Brunoise</b> is julienne cut across, so 3 mm cubes.</li>' +
            '<li><b>Batonnet</b> 6 mm by 6 mm by 60 mm. Cut across it and you have <b>small dice</b>, 6 mm.</li>' +
            '<li><b>Medium dice</b> 12 mm, <b>large dice</b> 20 mm, <b>chiffonade</b> for rolled leaves.</li>' +
            '</ul>' +
            '<p>Uniformity is not decoration. Pieces of the same size reach doneness at the same moment. A shallot minced unevenly gives you scorched fragments alongside raw crescents, and both end up in the sauce.</p>' +
            '<p>For that shallot: cut it in half through the root, peel, lay a half flat. Make two or three horizontal cuts toward the root without going through it, then vertical cuts down the length, then slice across. The root holds the whole thing together until the last cut.</p>'
        },
        {
          heading: 'Sharp is safe, and staying sharp is a habit',
          html:
            '<p>A dull edge slides off an onion skin and into your knuckle. A sharp one bites where you put it. Most European knives are ground near 20 degrees per side, most Japanese knives near 15, and that angle is the number you hold against the stone.</p>' +
            '<p>Honing and sharpening are different jobs. A steel or ceramic rod realigns an edge that has rolled over, and it is a thing you do every few uses, ten light strokes a side. Sharpening removes metal: 1000 grit to set the edge until a burr runs the length of it, then 3000 to 6000 to refine and strip the burr.</p>' +
            '<p>The rest is discipline. Never leave a knife in a sink of water. Carry it point down against your leg. Wash and dry it by hand the moment you finish with it, because dishwasher heat and detergent will pit the steel and knock the edge off anyway.</p>'
        }
      ],
      keyPoints: [
        'Pinch grip on the blade, claw on the guide hand, damp cloth under the board.',
        'The guide-hand knuckle sets slice thickness, which is what makes cuts uniform.',
        'Julienne 3 mm, batonnet 6 mm, small dice 6 mm, medium 12 mm, large 20 mm.',
        'Uniform pieces finish at the same time, and a sauce gives shallots about 45 seconds.',
        'Hone often to realign the edge, sharpen at 15 to 20 degrees to make a new one.'
      ],
      exposureClaim: {
        concept: 'nema:knife-skills',
        ability: 'recognize',
        evidenceType: 'recognition'
      }
    }
  },

  'ratios-diagnostic': {
    id: 'ratios-diagnostic',
    version: '1.0.0',
    title: 'Which vinaigrette holds',
    type: 'diagnostic',
    minutes: 6,
    difficulty: 'intermediate',
    grader: 'deterministic',
    evidenceProduced: 'application',
    outcomes: [{ concept: 'nema:ratios', ability: 'apply' }],
    skipIf: [],
    onlyIf: [{ concept: 'nema:ratios', ability: 'apply', status: 'uncertain' }],
    includeReason:
      'Included: ratios are uncertain in your vault. Six minutes here can replace the fourteen minute primer.',
    skipReason: 'Skipped: your vault already proves you can apply ratios.',
    notApplicableReason:
      'Not applicable: this check only runs when ratios are uncertain. With no evidence at all, the primer is the cheaper route.',
    whatTheLearnerDoes: 'Reads four written vinaigrettes and picks the one that tastes right and still holds at the pass.',
    content: {
      prompt:
        'You need 400 ml of vinaigrette for a bitter leaf salad. It is mixed at 19:30 and the first salads are dressed at 19:40. Which of the four builds tastes balanced and is still one liquid ten minutes later?',
      context: {
        html:
          '<p>The acid on the bench is a 5 percent cider vinegar. The oil is a mild cold pressed sunflower. There is Dijon, salt and a whisk.</p>' +
          '<p>Two things have to be true at once, and each build below fails or passes on both counts independently:</p>' +
          '<ul>' +
          '<li><b>Balance.</b> Enough acid to cut the fat, not so much that it strips the leaf.</li>' +
          '<li><b>Stability.</b> Something in the bowl keeping the oil in droplets while the dressing sits.</li>' +
          '</ul>'
      },
      options: [
        {
          id: 'ratio-a',
          html:
            '<p><b>1 part oil to 1 part vinegar.</b> 200 ml oil, 200 ml cider vinegar, salt, whisked hard for a minute in a cold bowl.</p>',
          whyWrong:
            'Half the dressing is vinegar. That is roughly three times the acid a leaf can carry, it strips the palate before anyone tastes the salad, and nothing in the bowl is keeping the oil dispersed. Whisking harder fixes neither problem: it adds energy, not an emulsifier.'
        },
        {
          id: 'ratio-b',
          html:
            '<p><b>3 parts oil to 1 part acid, with mustard.</b> 100 ml cider vinegar, 1 heaped teaspoon of Dijon per 100 ml of finished dressing, salt dissolved in the vinegar first, then 300 ml of oil drizzled in while whisking.</p>',
          whyWrong: ''
        },
        {
          id: 'ratio-c',
          html:
            '<p><b>3 parts oil to 1 part acid, no mustard.</b> 100 ml cider vinegar and 300 ml oil, salt, whisked cold in a bowl until it goes cloudy.</p>',
          whyWrong:
            'The ratio is right and the seasoning will be right, so this one tastes correct at 19:30. Nothing is stabilising the interface, though. Whisked oil and vinegar is a mechanical emulsion held only by the energy you put in, the droplets coalesce within a minute or two, and by 19:40 the oil is pooled on top and the last plates get dressed in vinegar.'
        },
        {
          id: 'ratio-d',
          html:
            '<p><b>1 part oil to 3 parts acid.</b> 300 ml cider vinegar, 100 ml oil, salt, whisked hard with a teaspoon of Dijon.</p>',
          whyWrong:
            'The ratio is inverted. Three parts vinegar to one part oil is a marinade, not a dressing: it is sour enough to pucker, and the acid wilts and bleaches a bitter leaf on contact. The mustard is doing honest work here, which is what makes this one tempting, but a stable dressing that nobody can eat is still a failure.'
        }
      ],
      answerKey: 'ratio-b',
      explanation:
        'Three parts oil to one part acid is the classical vinaigrette, and the teaspoon of Dijon per 100 ml is what turns a shake into a sauce. Mustard carries seed mucilage and proteins that sit at the boundary between oil and vinegar, lower the surface tension there and stop the droplets from merging back together, so the dressing is still one liquid at the pass. Dissolving the salt in the vinegar first matters too, because salt will not dissolve in oil. Drizzling the oil in slowly while whisking is what makes the droplets small in the first place, and small droplets are slow droplets. Adjust the ratio to the acid you actually have: a sharper 7 percent vinegar wants closer to 4 to 1, and lemon juice at roughly 6 percent acid sits in between.',
      hints: [
        'Two questions, not one. Does it taste balanced on a bitter leaf, and is there anything in the bowl that will still be holding the oil in ten minutes.',
        'Whisking adds energy, it does not add an emulsifier. Ask what is physically sitting between the oil and the vinegar in each of the four.'
      ]
    }
  },

  'ratios-primer': {
    id: 'ratios-primer',
    version: '1.0.0',
    title: 'Cooking by ratio',
    type: 'lesson',
    minutes: 14,
    difficulty: 'introductory',
    grader: 'exposure',
    evidenceProduced: 'recognition',
    outcomes: [{ concept: 'nema:ratios', ability: 'recognize' }],
    skipIf: [{ concept: 'nema:ratios', ability: 'apply', status: 'uncertain' }],
    includeReason: 'Included: your vault has no usable evidence for ratios.',
    skipReason: 'Skipped: your vault already has evidence for ratios at this level.',
    whatTheLearnerDoes: 'Reads three short sections and marks the lesson complete.',
    content: {
      intro:
        'A recipe is one instance. A ratio is the structure underneath a whole family of them, and it fits in your head. Learn six ratios and you stop reading recipes for permission and start reading them for ideas.',
      sections: [
        {
          heading: 'Ratios are by weight, and that is not pedantry',
          html:
            '<p>A cup of flour is anywhere between 120 and 150 g depending on how it was scooped, which is a 25 percent error before you have done anything. Weight removes the argument. Put the bowl on the scale, tare, and work in grams.</p>' +
            '<p>Volume survives in one place, dressings and marinades, where the parts are liquids of similar density and nobody wants to weigh 15 ml of vinegar. Everywhere else, weigh it.</p>' +
            '<p>Ratios also travel. Once you know that a vinaigrette is 3 parts oil to 1 part acid, you can make 60 ml for two plates or 2 litres for a wedding without looking anything up, and you can swap sherry vinegar for lemon by tasting rather than by searching for another recipe.</p>'
        },
        {
          heading: 'Six that earn their place at the stove',
          html:
            '<ul>' +
            '<li><b>Vinaigrette</b> 3 : 1 oil to acid, plus about 5 g of Dijon per 100 ml as the emulsifier.</li>' +
            '<li><b>Roux</b> 1 : 1 flour to butter by weight. For a medium bechamel, 60 g flour plus 60 g butter per litre of milk.</li>' +
            '<li><b>Seasoning</b> 1 percent salt by the weight of the food, so 10 g per kilogram. A wet brine runs 5 to 6 percent for 8 to 12 hours.</li>' +
            '<li><b>Beurre blanc</b> roughly 1 part acid reduction to 4 parts butter: 60 ml of reduced wine and vinegar carries 225 g of butter.</li>' +
            '<li><b>Mounted pan sauce</b> about 2 parts reduced liquid to 1 part cold butter: 120 ml of reduction takes 60 g, which sauces four plates.</li>' +
            '<li><b>Baked custard</b> 1 whole egg, or 2 yolks, per 240 ml of dairy.</li>' +
            '</ul>' +
            '<p>Notice that two of those six are emulsions with an explicit fat to liquid limit. That limit is not style, it is capacity: one egg yolk will hold about 240 ml of oil as mayonnaise and no more, and a reduction that is too thin cannot carry the butter you want to put in it.</p>'
        },
        {
          heading: 'A ratio is a starting point, the palate is the instrument',
          html:
            '<p>Ratios assume standard ingredients, and your ingredients are not standard. A 7 percent vinegar, a bitter oil, a stock already reduced by a previous cook: each one moves the numbers. So mix by the ratio, then taste and adjust in one direction at a time.</p>' +
            '<p>Know what each adjustment does. Salt raises perceived sweetness and suppresses bitterness, so a flat sauce is usually under salted rather than under flavoured. Acid cuts fat and makes a rich sauce readable, which is why a few drops of vinegar at the end of a butter sauce wakes the whole thing up. Fat rounds off sharp edges: if a dressing bites, add oil before you reach for sugar.</p>' +
            '<p>Write down what you changed. A ratio you have adjusted twice for your own vinegar is worth more than the one in the book, and it is the only way the next service starts where this one ended.</p>'
        }
      ],
      keyPoints: [
        'Work in grams. A cup of flour varies by 25 percent, a ratio by weight does not.',
        'Vinaigrette 3 : 1 oil to acid, roux 1 : 1 flour to butter, seasoning 1 percent salt by weight.',
        'Beurre blanc is about 1 part reduction to 4 parts butter, a pan sauce about 2 parts reduction to 1 part butter.',
        'Emulsions have a capacity: one yolk holds roughly 240 ml of oil, a thin reduction cannot carry much butter.',
        'Mix by the ratio, then taste: salt for flatness, acid for richness, fat for sharpness.'
      ],
      exposureClaim: {
        concept: 'nema:ratios',
        ability: 'recognize',
        evidenceType: 'recognition'
      }
    }
  },

  'pan-sauce-anatomy': {
    id: 'pan-sauce-anatomy',
    version: '1.0.0',
    title: 'Anatomy of a pan sauce',
    type: 'lesson',
    minutes: 4,
    difficulty: 'intermediate',
    grader: 'exposure',
    evidenceProduced: 'recognition',
    outcomes: [{ concept: 'nema:pan-sauces', ability: 'recognize' }],
    skipIf: [],
    includeReason: 'Included: this is the core lesson of the unit.',
    skipReason: '',
    whatTheLearnerDoes: 'Reads three short sections and marks the lesson complete.',
    content: {
      intro:
        'A pan sauce is not a recipe, it is a sequence. Five moves, always in the same order, and each one exists because the move before it left something behind.',
      sections: [
        {
          heading: 'Five moves',
          html:
            '<p><b>Fond.</b> The browned protein and sugars welded to the pan after a sear. That is the flavour, and it is currently stuck to metal.</p>' +
            '<p><b>Deglaze.</b> Wine, stock or water dissolves the fond and lifts it back into the liquid.</p>' +
            '<p><b>Reduce.</b> Water leaves, flavour and gelatin concentrate, viscosity climbs.</p>' +
            '<p><b>Mount.</b> Cold butter goes in off the heat and turns a thin brown liquid into a glossy sauce.</p>' +
            '<p><b>Adjust.</b> Salt and a few drops of acid, tasted on a spoon, not guessed.</p>'
        },
        {
          heading: 'Why each move is where it is',
          html:
            '<p>Deglazing is a solubility trick: those browned compounds dissolve in water and alcohol, not in the fat sitting on top of them, which is why you pour off most of the fat first. Reduction comes before enrichment because butter added to a watery pan cannot thicken it and will only sit on the surface.</p>' +
            '<p>Mounting is the part that fails. Butter is already an emulsion, roughly 80 percent fat, 16 percent water and 2 percent milk solids, and those milk solids and the lecithin in them are the emulsifier you are relying on. Cold butter goes in slowly enough that the fat disperses as droplets instead of pooling, and off the heat because above about 90 C the emulsion breaks and you get oil on a puddle.</p>'
        },
        {
          heading: 'The numbers, for four plates',
          html:
            '<p>Pour off the rendered fat, leaving about one tablespoon. Over medium heat, sweat one finely minced shallot for 45 seconds until translucent, not brown. Add 80 ml of dry white wine and scrape every stuck spot loose with a wooden spoon while it bubbles, then let it reduce almost dry.</p>' +
            '<p>Add 240 ml of brown chicken stock and simmer until it is down to about 120 ml, three to four minutes, and coats the back of a spoon. Pull the pan off the flame, wait until it stops simmering, then swirl in 60 g of cold cubed butter a few pieces at a time. Salt, then four or five drops of sherry vinegar or lemon. Hold it between 60 and 70 C. It will not survive a second boil.</p>'
        }
      ],
      keyPoints: [
        'The sequence is fond, deglaze, reduce, mount, adjust, and it does not reorder.',
        'Pour off most of the fat first: fond dissolves in the liquid, not in the fat.',
        'Concentration before enrichment. Butter cannot thicken a watery pan.',
        'Butter is about 80 percent fat, 16 percent water and 2 percent milk solids, and the solids are the emulsifier.',
        'Mount off the heat and hold between 60 and 70 C. Above roughly 90 C the sauce splits.'
      ],
      exposureClaim: {
        concept: 'nema:pan-sauces',
        ability: 'recognize',
        evidenceType: 'recognition'
      }
    }
  },

  'fix-the-broken-sauce': {
    id: 'fix-the-broken-sauce',
    version: '1.0.0',
    title: 'Fix the broken sauce',
    type: 'interactive-lab',
    minutes: 12,
    difficulty: 'intermediate',
    grader: 'deterministic',
    evidenceProduced: 'application',
    outcomes: [
      { concept: 'nema:pan-sauces', ability: 'apply' },
      { concept: 'nema:emulsions', ability: 'discriminate' }
    ],
    skipIf: [],
    includeReason: 'Included: this lab is where the unit outcome is earned.',
    skipReason: '',
    whatTheLearnerDoes:
      'Selects the steps to put into the remake and orders the three stages, then tastes the sauce again.',
    content: {
      scenario: {
        html:
          '<p>Dinner for six. Six duck breasts are out of the pan and resting under foil, the potatoes are in, and the sauce is due on the plates in four minutes.</p>' +
          '<p>The commis made it while you were carving. He left all the rendered fat in the pan, dropped 120 g of cold butter straight into the dry, ripping hot saute pan, poured the wine in after the butter, never scraped the fond, and then boiled the whole thing hard for four minutes to thicken it. It is sitting there as two layers: clear fat floating over a thin brown liquid.</p>' +
          '<p>You have one pan, four minutes and the same ingredients. Choose the steps that go into the remake, leave out the ones that would break it again, and put the three stages in order.</p>'
      },
      brokenHarness: {
        json: {
          service: 'Saturday dinner, six covers, duck breast',
          pan: '28 cm stainless saute, heavy dark fond, still welded to the base',
          fatLeftInPan: '60 ml of rendered duck fat, none poured off',
          method: [
            '120 g cold butter dropped into the dry pan straight off the sear',
            '150 ml wine poured in after the butter, fond never scraped loose',
            'no stock added, no reduction, about 300 ml of liquid in the pan',
            'held at a rolling boil for four minutes to thicken it'
          ],
          burner: 'high, never lowered',
          seasoning: { salt: 'none since the sear', acid: 'none' },
          onThePass: 'broken: a fat layer floating over a thin brown liquid'
        }
      },
      beforeRun: [
        '19:42 [pass] six breasts resting, sauce called for in four minutes',
        '19:43 [look] separated, a clear fat layer sitting over a thin brown liquid',
        '19:43 [spoon] runs straight off the back of the spoon and leaves no coat at all',
        '19:44 [taste] greasy film across the lip first, then a thin, watery finish',
        '19:44 [taste] flat: no salt lift, no acid, and it still tastes of raw wine',
        '19:45 [chef] sauce rejected, remake it before the mains go out'
      ],
      checks: [
        {
          id: 'deglaze-the-fond',
          label: 'Deglaze the fond with wine or stock',
          detail:
            'Pour off all but a tablespoon of the duck fat, put the pan back on medium heat, add 80 ml of dry white wine and scrape every brown spot off the base with a wooden spoon while it bubbles.',
          kind: 'required'
        },
        {
          id: 'reduce-by-half',
          label: 'Reduce by half before any butter goes in',
          detail:
            'Add 240 ml of brown chicken stock and simmer it down to about 120 ml, until it coats the back of a spoon and a finger drawn through leaves a line. Concentration before enrichment.',
          kind: 'required'
        },
        {
          id: 'mount-cold-butter-off-heat',
          label: 'Mount with cold butter off the heat',
          detail:
            'Take the pan off the flame, let it fall out of the simmer to roughly 80 C, then swirl in 60 g of cold cubed butter three or four pieces at a time until the sauce turns glossy and opaque.',
          kind: 'required'
        },
        {
          id: 'boil-after-mounting',
          label: 'Bring it back to a rolling boil after mounting',
          detail:
            'Once the butter is in and the sauce looks right, put it back over high heat and boil it hard for a minute to tighten it further.',
          kind: 'harmful'
        },
        {
          id: 'butter-into-dry-hot-pan',
          label: 'Add the butter to the dry ripping hot pan',
          detail:
            'Drop the cold butter into the empty pan straight off the sear, before any liquid goes in, and let the residual heat melt it down.',
          kind: 'harmful'
        },
        {
          id: 'warm-the-plates',
          label: 'Warm the plates in the low oven',
          detail:
            'Hold the six plates at about 60 C so the sauce does not chill on the way from the pass to the table.',
          kind: 'neutral'
        },
        {
          id: 'pass-through-chinois',
          label: 'Pass the sauce through a chinois',
          detail:
            'Strain out the shallot and the loose fragments of fond for a cleaner sheen before the sauce goes on the plate.',
          kind: 'neutral'
        },
        {
          id: 'log-the-timings',
          label: 'Log the reduction time on the prep sheet',
          detail:
            'Write down how long the reduction took at this volume so the next service can start it earlier.',
          kind: 'neutral'
        }
      ],
      stages: [
        { id: 'deglaze', label: 'Deglaze' },
        { id: 'reduce', label: 'Reduce' },
        { id: 'mount', label: 'Mount' }
      ],
      afterRun: [
        '19:51 [pan] fat poured off, shallot sweated 45 seconds, 80 ml wine in, fond scraped clean',
        '19:53 [pan] wine reduced almost dry, 240 ml of brown chicken stock added',
        '19:55 [pan] down to about 120 ml, off the flame, 60 g of cold butter swirled in four pieces',
        '19:56 [look] glossy and opaque, one sauce instead of two layers',
        '19:56 [spoon] coats the back of the spoon, a finger drawn through leaves a clean line',
        '19:57 [taste] round and savoury, salt adjusted, four drops of sherry vinegar to lift it',
        '19:58 [pass] held at 65 C for twelve minutes, still holds on the pass, mains away'
      ],
      hints: [
        'Nothing in that pan ever met an emulsifier, and nothing was ever concentrated. Ask what is going to hold the fat and the water together, and what has to happen before there is anything worth holding.',
        'Two of these make it worse. Butter is itself an emulsion, roughly 80 percent fat, 16 percent water and 2 percent milk solids. Ask what a hot dry pan does to each of those three, and what a rolling boil does to the finished sauce.',
        'Concentration comes before enrichment. A sauce that is still thin when the butter goes in is a sauce you will be tempted to boil, and boiling it is what broke the first one.'
      ],
      answerKey: {
        requiredChecks: ['deglaze-the-fond', 'reduce-by-half', 'mount-cold-butter-off-heat'],
        harmfulChecks: ['boil-after-mounting', 'butter-into-dry-hot-pan'],
        stageOrder: ['deglaze', 'reduce', 'mount']
      }
    }
  },

  'explain-without-the-recipe': {
    id: 'explain-without-the-recipe',
    version: '1.0.0',
    title: 'Explain it without the recipe',
    type: 'free-recall',
    minutes: 5,
    difficulty: 'intermediate',
    grader: 'provider-rubric',
    evidenceProduced: 'explanation',
    outcomes: [{ concept: 'nema:pan-sauces', ability: 'explain' }],
    skipIf: [],
    includeReason: 'Included: saying it from memory is what makes the lab stick.',
    skipReason: '',
    whatTheLearnerDoes: 'Writes a short paragraph from memory, with the lesson closed.',
    content: {
      prompt:
        'Close the lesson. In your own words, explain to a commis what a pan sauce physically is, what holds it together, and why the last one split on the pass. Write at least 40 words and name the temperature you would hold it at.',
      rubric: [
        {
          id: 'emulsion-named',
          criterion:
            'Names the sauce as an emulsion of fat and water rather than a liquid that was simply thickened.',
          keywords: [
            'emulsion',
            'emulsif',
            'emulsify',
            'fat and water',
            'water and fat',
            'oil and water',
            'water and oil',
            'fat in the water',
            'fat into the water'
          ]
        },
        {
          id: 'what-holds-it',
          criterion:
            'Says what physically holds it: the fat dispersed as droplets, kept apart by an emulsifier such as mustard or the milk solids in butter.',
          keywords: [
            'droplet',
            'dispers',
            'suspend',
            'emulsifier',
            'mustard',
            'lecithin',
            'milk solid',
            'butter protein',
            'casein',
            'coalesc'
          ]
        },
        {
          id: 'heat-window',
          criterion:
            'Names heat as what breaks it, or gives the temperature window where a butter emulsion holds.',
          keywords: [
            'temperature',
            'heat',
            'too hot',
            'boil',
            'simmer',
            'degrees',
            '85',
            '90',
            '65'
          ]
        }
      ],
      minWords: 40
    }
  }
};

/* ------------------------------------------------------------------ */
/* Manifest, derived from ACTIVITIES so the numbers cannot drift        */
/* ------------------------------------------------------------------ */

const ACTIVITY_LIST = Object.values(ACTIVITIES);
const FULL_MINUTES = ACTIVITY_LIST.reduce((sum, a) => sum + a.minutes, 0); // 68

export const MANIFEST = {
  protocol: 'nema/0.1',
  provider: {
    origin: PROVIDER_ORIGIN,
    name: 'Saucier School',
    keyId: 'saucier-2026-09'
  },
  unit: {
    id: 'pan-sauces-foundations',
    version: '1.0.0',
    title: 'Pan Sauces and Emulsions',
    estimatedMinutes: FULL_MINUTES,
    language: 'en',
    price: 'free'
  },
  outcomes: [
    { concept: 'nema:pan-sauces', ability: 'apply' },
    { concept: 'nema:pan-sauces', ability: 'explain' },
    { concept: 'nema:emulsions', ability: 'discriminate' },
    { concept: 'nema:ratios', ability: 'apply' }
  ],
  requirements: [
    { concept: 'nema:knife-skills', ability: 'apply' },
    { concept: 'nema:heat-control', ability: 'explain' },
    { concept: 'nema:ratios', ability: 'apply' }
  ],
  activities: ACTIVITY_LIST.map((a) => {
    const entry = {
      id: a.id,
      type: a.type,
      title: a.title,
      minutes: a.minutes,
      evidenceProduced: a.evidenceProduced,
      grader: a.grader,
      outcomes: a.outcomes,
      skipIf: a.skipIf
    };
    if (a.onlyIf) entry.onlyIf = a.onlyIf;
    return entry;
  })
};

export const CONTENT_HASH_INPUT = JSON.stringify(ACTIVITIES);

/* ------------------------------------------------------------------ */
/* Path personalization                                                */
/* ------------------------------------------------------------------ */

const STATUS_RANK = { missing: 0, uncertain: 1, verified: 2 };

function statusOf(statuses, concept, ability) {
  const value = statuses[concept + '|' + ability];
  return Object.prototype.hasOwnProperty.call(STATUS_RANK, value) ? value : 'missing';
}

/**
 * skipIf semantics (CONTRACT 5.1): a required status is satisfied by that
 * status or anything stronger. verified satisfies verified; verified or
 * uncertain satisfies uncertain.
 */
function satisfiesSkip(actual, required) {
  return STATUS_RANK[actual] >= (STATUS_RANK[required] ?? 0);
}

function pathEntry(activity, reason) {
  return {
    activityId: activity.id,
    title: activity.title,
    type: activity.type,
    minutes: activity.minutes,
    reason
  };
}

/**
 * personalizePath(statuses)
 *
 * statuses: { "<concept>|<ability>": 'verified' | 'uncertain' | 'missing' }
 * A key that is absent, or carries a value outside the three bands, is treated
 * as 'missing'.
 *
 * Pass null (or nothing) for "no readiness assertion has been presented yet":
 * that returns the whole offer, 68 minutes, with an empty skipped list. This is
 * the call the page makes before personalization. An empty object is accepted
 * as the same thing for callers that have no assertion to hand, but null is the
 * explicit form and the one the UI should use, because an assertion that
 * genuinely reports every requirement missing is a different answer: it keeps
 * the remedial lessons and drops the diagnostic, 62 minutes.
 *
 * Returns { path, skipped, fullMinutes, personalMinutes }.
 */
export function personalizePath(statuses) {
  const known = statuses && typeof statuses === 'object' ? statuses : {};
  const hasAssertion = Object.keys(known).length > 0;

  const path = [];
  const skipped = [];

  for (const activity of ACTIVITY_LIST) {
    if (!hasAssertion) {
      path.push(pathEntry(activity, 'Included: no readiness assertion presented yet.'));
      continue;
    }

    // onlyIf: every entry must match the reported status exactly.
    if (Array.isArray(activity.onlyIf) && activity.onlyIf.length > 0) {
      const applies = activity.onlyIf.every(
        (entry) => statusOf(known, entry.concept, entry.ability) === entry.status
      );
      if (!applies) {
        // Two different learners fall out of an onlyIf gate and they deserve
        // two different sentences. One is past the activity (every entry is
        // stronger than the gate asks for), the other never needed it.
        const outranked = activity.onlyIf.every(
          (entry) =>
            STATUS_RANK[statusOf(known, entry.concept, entry.ability)] >
            (STATUS_RANK[entry.status] ?? 0)
        );
        skipped.push({
          activityId: activity.id,
          title: activity.title,
          minutes: activity.minutes,
          reason: outranked
            ? activity.skipReason || 'Skipped: your vault already covers this.'
            : activity.notApplicableReason || 'Not applicable to your current state.'
        });
        continue;
      }
    }

    // skipIf: every entry must be satisfied for the activity to be skipped.
    const skipRules = Array.isArray(activity.skipIf) ? activity.skipIf : [];
    const shouldSkip =
      skipRules.length > 0 &&
      skipRules.every((entry) =>
        satisfiesSkip(statusOf(known, entry.concept, entry.ability), entry.status)
      );

    if (shouldSkip) {
      skipped.push({
        activityId: activity.id,
        title: activity.title,
        minutes: activity.minutes,
        reason: activity.skipReason || 'Skipped: your vault already covers this.'
      });
    } else {
      path.push(pathEntry(activity, activity.includeReason || 'Included.'));
    }
  }

  return {
    path,
    skipped,
    fullMinutes: FULL_MINUTES,
    personalMinutes: path.reduce((sum, item) => sum + item.minutes, 0)
  };
}

/* ------------------------------------------------------------------ */
/* Graders                                                             */
/* ------------------------------------------------------------------ */

function claim(concept, ability, evidenceType, result, difficulty) {
  return { concept, ability, evidenceType, result, difficulty };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (typeof item === 'string' && !out.includes(item)) out.push(item);
  }
  return out;
}

/**
 * Keywords are stems, not whole words: the match is anchored at a word
 * boundary on the left and left open on the right, so 'droplet' also matches
 * "droplets", and 'emulsif' matches "emulsifier", "emulsify" and "emulsified".
 * Anchoring on the left is what keeps "preheat" and "nonemulsified" from
 * counting.
 */
function keywordHit(text, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('\\b' + escaped, 'i').test(text);
}

function gradeLesson(activity, submission) {
  const completed = submission && submission.completed === true;
  if (!completed) {
    return {
      result: 'failed',
      score: 0,
      feedback: ['Mark the lesson complete once you have read all three sections.'],
      claims: []
    };
  }
  const exposure = activity.content.exposureClaim;
  return {
    result: 'passed',
    score: 1,
    feedback: [
      'Lesson complete. This produces an exposure receipt, the weakest kind of evidence: it records that you read the material, not that you can cook it.'
    ],
    claims: [
      claim(exposure.concept, exposure.ability, exposure.evidenceType, 'passed', activity.difficulty)
    ]
  };
}

function gradeDiagnostic(activity, submission) {
  const { answerKey, options } = activity.content;
  const optionId = submission && typeof submission.optionId === 'string' ? submission.optionId : '';
  const chosen = options.find((o) => o.id === optionId);

  if (!chosen) {
    return {
      result: 'failed',
      score: 0,
      feedback: ['Pick one of the four vinaigrettes.'],
      claims: []
    };
  }

  if (chosen.id !== answerKey) {
    return {
      result: 'failed',
      score: 0,
      feedback: [chosen.whyWrong, 'Read the four builds again with the pass in mind and try once more.'],
      claims: []
    };
  }

  // Hints are not a penalty here. How many were open travels to the vault in
  // conditions.hintsUsed, and the vault decides what that is worth.
  return {
    result: 'passed',
    score: 1,
    feedback: [activity.content.explanation],
    claims: [claim('nema:ratios', 'apply', 'application', 'passed', activity.difficulty)]
  };
}

function gradeLab(activity, submission) {
  const { answerKey, checks, stages } = activity.content;
  const validCheckIds = checks.map((c) => c.id);
  const selected = uniqueStrings(submission && submission.checks).filter((id) =>
    validCheckIds.includes(id)
  );
  const order = uniqueStrings(submission && submission.stageOrder).filter((id) =>
    stages.some((s) => s.id === id)
  );

  const requiredHit = answerKey.requiredChecks.filter((id) => selected.includes(id));
  const harmfulHit = answerKey.harmfulChecks.filter((id) => selected.includes(id));
  const allRequired = requiredHit.length === answerKey.requiredChecks.length;
  const noHarmful = harmfulHit.length === 0;
  const orderOk =
    order.length === answerKey.stageOrder.length &&
    order.every((id, i) => id === answerKey.stageOrder[i]);

  const feedback = [];

  if (allRequired && noHarmful && orderOk) {
    feedback.push(
      'That is a sauce. The fond is back in the liquid instead of welded to the pan, 240 ml of stock is down to about 120, and cold butter off the heat has taken it glossy and opaque.'
    );
    feedback.push(
      'The order carries as much weight as the steps: deglaze while there is fond to lift, reduce while there is still water to lose, mount last and below a simmer, because the butter emulsion is the one part of this that a boil can undo.'
    );
    return {
      result: 'passed',
      score: 1,
      feedback,
      claims: [
        claim('nema:pan-sauces', 'apply', 'application', 'passed', activity.difficulty),
        claim('nema:emulsions', 'discriminate', 'discrimination', 'passed', activity.difficulty)
      ]
    };
  }

  if (allRequired && noHarmful) {
    feedback.push('The three steps are right. The stages are not in a workable order.');
    feedback.push(
      'Butter that goes in before the reduction has nothing concentrated to emulsify into, and a pan deglazed after the sauce is mounted is a butter sauce with the flavour left on the metal.'
    );
    return {
      result: 'partial',
      score: 0.7,
      feedback,
      claims: [claim('nema:pan-sauces', 'apply', 'application', 'partial', activity.difficulty)]
    };
  }

  if (!allRequired) {
    const missing = answerKey.requiredChecks.length - requiredHit.length;
    feedback.push(
      missing === 1
        ? 'One necessary step is still missing. Taste the notes again: which of the faults, greasy, thin or flat, is nothing in your remake addressing.'
        : missing + ' necessary steps are still missing. Walk the tasting notes again, fault by fault.'
    );
  }
  if (!noHarmful) {
    feedback.push(
      'At least one selected step is what breaks a sauce rather than what fixes it. Take out anything that puts butter into a dry hot pan or takes a mounted sauce back to a boil.'
    );
  }
  if (!orderOk) {
    feedback.push('The three stages also need the order that lets each one leave something for the next.');
  }

  const score = round2(
    Math.max(
      0,
      (requiredHit.length / answerKey.requiredChecks.length) * 0.6 -
        harmfulHit.length * 0.2 +
        (orderOk ? 0.2 : 0)
    )
  );

  return { result: 'failed', score, feedback, claims: [] };
}

function gradeFreeRecall(activity, submission) {
  const { rubric, minWords } = activity.content;
  const text = submission && typeof submission.text === 'string' ? submission.text : '';
  const words = text.trim().split(/\s+/).filter(Boolean);
  const met = rubric.filter((criterion) => criterion.keywords.some((k) => keywordHit(text, k)));
  const metIds = met.map((c) => c.id);
  const missed = rubric.filter((c) => !metIds.includes(c.id));

  if (words.length < minWords) {
    return {
      result: 'failed',
      score: 0,
      feedback: [
        'Too short to grade. Write at least ' +
          minWords +
          ' words, this answer has ' +
          words.length +
          '.'
      ],
      claims: []
    };
  }

  const feedback = [];
  if (metIds.length === rubric.length) {
    feedback.push(
      'All ' + rubric.length + ' rubric criteria are covered. This is recorded as a rubric graded explanation.'
    );
  } else {
    feedback.push(metIds.length + ' of ' + rubric.length + ' rubric criteria are covered.');
    for (const criterion of missed) {
      feedback.push('Still missing: ' + criterion.criterion);
    }
  }

  // Every criterion is a pass, one short is a partial, anything less is a fail.
  const result =
    metIds.length === rubric.length
      ? 'passed'
      : metIds.length > 0 && metIds.length === rubric.length - 1
        ? 'partial'
        : 'failed';
  const score = round2(metIds.length / rubric.length);

  return {
    result,
    score,
    feedback,
    claims:
      result === 'failed'
        ? []
        : [claim('nema:pan-sauces', 'explain', 'explanation', result, activity.difficulty)]
  };
}

/**
 * grade(activityId, submission) -> { result, score, feedback, claims }
 *
 * Deterministic and side effect free. The worker re-grades every submission
 * before it signs a receipt, so the browser can never talk a receipt into
 * existence by posting a result.
 */
export function grade(activityId, submission) {
  const activity = ACTIVITIES[activityId];
  if (!activity) {
    return {
      result: 'failed',
      score: 0,
      feedback: ['Unknown activity: ' + String(activityId)],
      claims: []
    };
  }

  switch (activity.type) {
    case 'lesson':
      return gradeLesson(activity, submission);
    case 'diagnostic':
      return gradeDiagnostic(activity, submission);
    case 'interactive-lab':
      return gradeLab(activity, submission);
    case 'free-recall':
      return gradeFreeRecall(activity, submission);
    default:
      return {
        result: 'failed',
        score: 0,
        feedback: ['No grader for activity type ' + activity.type + '.'],
        claims: []
      };
  }
}
