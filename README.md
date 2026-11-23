<p align="center"><img src="brand-mark.png" alt="Viewramp logo" width="88"></p>
<h1 align="center">Viewramp</h1>
<p align="center">Compare YouTube video performance and turn retention drops into editing notes.</p>
<p align="center"><a href="https://clankclankclankclank.github.io/viewramp/"><strong>Open Viewramp</strong></a></p>

## What you can do

- Compare two videos side by side across views, watch time, estimated average viewed, thumbnail CTR, and net subscribers.
- Narrow the comparison by video length and publishing date, and inspect daily channel views when a totals export is available.
- Overlay two timestamped retention curves, see the largest reported drops between points, and bookmark moments for review.
- Keep timestamped notes in your browser and export them as a text file.

## Try it in a minute

Choose **Load sample**, compare **Video A** and **Video B**, then select both curves under **Audience retention**. Pick a timestamp under **Largest drops** to start a note for that moment.

## Import your own analytics

1. In YouTube Studio, open **Analytics → Advanced Mode** and choose your date range.
2. Select the content breakdown and include views, watch time, and any other metrics you want to compare.
3. Choose **Export current view**, select CSV, and unzip the download if needed.
4. Import **Table data.csv** for video comparisons and **Totals.csv** for daily views when available.

Timestamped curves require a separate export or CSV with elapsed time and retention percentages. Video summary CSVs support aggregate comparisons. For timestamped analysis, use elapsed seconds or a timestamp such as `0:05`:

```csv
Timestamp,Audience retention (%)
0:00,100
0:05,83
0:10,71
```

Files are processed in your browser. Notes are saved locally, and you can export them for use in an editing plan.

## Run locally

From the repository root, serve the static files with Python 3:

```sh
python3 -m http.server 8000
```

Open [localhost:8000](http://localhost:8000). Viewramp uses HTML, CSS, and JavaScript and runs without a build step.
