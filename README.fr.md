# Mods pour Claude Code

[English](README.md) · [Русский](README.ru.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [Deutsch](README.de.md) · **Français**

## plan-progress

Des barres de progression en direct au-dessus du champ de saisie de Claude Code. Claude découpe la tâche en étapes et en pas, et la barre se remplit au fil du travail. Les sous-agents de chaque tâche s'affichent sous sa barre.

![plan-progress : deux tâches avec leurs agents, une question, une erreur, un plan réécrit en cours de route, les deux tâches terminées](media/plan-progress.gif)

[Voir avec le son (MP4, 14 s)](media/plan-progress.mp4)

- Une ligne par tâche : état, titre, barre, pourcentage, bouton de fermeture
- L'étiquette de la barre indique l'étape et le pas en cours ; au survol, le temps écoulé
- Les étapes sont des capsules, les pas des points ; au survol d'un point passé, le temps qu'il a pris, d'un point à venir, ce qui commence là
- Une barre terminée passe au vert, affiche la durée totale et reste jusqu'à ce qu'on la ferme ; avec `/plan-progress-autoclose` activé, elle disparaît après `doneBarSeconds` (30 s par défaut, dans `/config`)
- Les points du remplissage et des lignes de sous-agents scintillent ; désactivez `twinkle` dans `/config` pour les figer
- Quatre états : en cours, réponse attendue, erreur, terminé
- Chaque sous-agent a sa ligne sous sa tâche : nom, modèle et effort, outil en cours, durée
- Le plan peut changer en cours de route ; les pas terminés sont conservés d'après leur titre
- Les barres sont enregistrées par session et reviennent à sa reprise
- Des sons brefs pour une question, une erreur et la fin
- Le pied de page affiche la vitesse d'écriture de la conversation principale, `⚡ N tok/s` ; les sous-agents ne comptent pas
- Le ⚙ à côté (dans l'application de bureau et le terminal en plein écran) ouvre une fenêtre de réglages : effets, fermeture automatique et ses secondes, sons, le chiffre lui-même, la version du mod et la recherche de mises à jour ; `/plan-progress-settings` l'ouvre partout. La fenêtre parle la langue de `/config`, sinon celle de l'application ou du système
- Mises à jour : un clic sur la version dans la fenêtre de réglages cherche une nouvelle version, et « Mettre à jour » l'installe puis recharge le mod sur place (si le rechargement ne prend pas, il demande un redémarrage). Toutes les 6 heures, le mod vérifie aussi de lui-même et marque le ⚙ d'un 🔹 (● dans le terminal) quand une nouvelle version est sortie. Une vérification est une seule requête à l'API GitHub (`api.github.com/repos/zycck/claude-mods/releases`), sans données de compte ni de session ; on la coupe avec « Rechercher les mises à jour » dans la fenêtre ou avec `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`. Une copie installée depuis un dossier n'est pas vérifiée
- Fonctionne dans l'application de bureau et dans le terminal
- Dans le terminal, la barre suit le mode clair ou sombre de GNOME avec le thème `auto` et prend les couleurs du thème Omarchy actif

### Installation

Nécessite Claude Code 2.1.295 ou plus récent (`claude --version` ; mise à jour avec `claude update`). Sur les versions antérieures, une partie du mod ne fonctionne pas : la fenêtre de réglages reste vide et, avant la 2.1.286, le module de hooks ne se charge pas du tout, aucune barre n'apparaît et au démarrage s'affiche `plan-progress: hooks module did not load`.

```
/plugin marketplace add zycck/claude-mods
/plugin install plan-progress@zycck-mods
```

Mise à jour :

```
claude plugin marketplace update zycck-mods
claude plugin update plan-progress@zycck-mods
```

### Commandes

- `/progress` affiche ou masque les barres
- `/progress-clear` supprime toutes les barres
- `/progress-agents` replie les bandes d'agents sous les barres ou les réaffiche (le bouton flèche à côté du ✕ d'une barre le fait pour cette barre)
- `/plan-progress-autoclose` active la fermeture automatique des barres terminées (désactivée par défaut) ou la désactive à nouveau ; le choix est conservé entre les sessions
- `/plan-progress-settings` ouvre la fenêtre de réglages, comme le ⚙ du pied de page (dans le terminal, le ⚙ n'apparaît qu'en plein écran)

### Fonctionnement

Le mod enregistre l'outil `plan_progress`. Claude envoie le plan une fois, puis de courtes mises à jour comme `{id, next: true}` ou `{id, done: ["Routes"]}`. Un nom de pas inconnu est refusé avec la liste des pas de la barre. Un plan approuvé en plan mode devient la barre `plan`. Les lignes des agents viennent des événements du moteur et ne consomment aucun token.

Dans l'application de bureau, la barre est une image SVG surmontée d'un calque de survol. Dans le terminal, c'est une grille de caractères qui ne s'anime que pendant que Claude travaille.

### Tests

`plugins/plan-progress/tests` exécute le vrai module sur un moteur simulé : `node compile.cjs ../hooks/register.tsx register.mjs`, puis `node regress.mjs` et `node scenarios.mjs`.

## Licence

MIT
