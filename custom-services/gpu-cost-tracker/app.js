const express = require("express");
const AWS = require("aws-sdk");
const app = express();

app.use(express.json());

const ce = new AWS.CostExplorer({ region: "us-east-1" });
const cloudwatch = new AWS.CloudWatch({ region: process.env.AWS_REGION || "ap-south-1" });

// Returns GPU cost breakdown by team tag for the last N days
app.get("/api/costs/by-team", async (req, res) => {
  const days = parseInt(req.query.days || "30");
  const end  = new Date().toISOString().split("T")[0];
  const start = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];

  try {
    const data = await ce.getCostAndUsage({
      TimePeriod: { Start: start, End: end },
      Granularity: "DAILY",
      Metrics: ["UnblendedCost"],
      Filter: {
        Dimensions: {
          Key: "SERVICE",
          Values: ["Amazon SageMaker", "Amazon EC2"],
        },
      },
      GroupBy: [
        { Type: "TAG", Key: "team" },
        { Type: "DIMENSION", Key: "SERVICE" },
      ],
    }).promise();

    const summary = {};
    for (const period of data.ResultsByTime) {
      for (const group of period.Groups) {
        const team    = group.Keys[0].replace("team$", "") || "untagged";
        const service = group.Keys[1];
        const cost    = parseFloat(group.Metrics.UnblendedCost.Amount);
        if (!summary[team]) summary[team] = { total: 0, breakdown: {} };
        summary[team].total += cost;
        summary[team].breakdown[service] = (summary[team].breakdown[service] || 0) + cost;
      }
    }

    // Round to 2dp
    Object.values(summary).forEach((t) => {
      t.total = Math.round(t.total * 100) / 100;
      Object.keys(t.breakdown).forEach((s) => {
        t.breakdown[s] = Math.round(t.breakdown[s] * 100) / 100;
      });
    });

    res.json({ period: { start, end, days }, teams: summary });
  } catch (err) {
    console.error("Cost Explorer error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Returns current GPU utilization across all nodes from CloudWatch Container Insights
app.get("/api/gpu/utilization", async (req, res) => {
  const clusterName = process.env.EKS_CLUSTER_NAME || "pratik-prod";
  const end   = new Date();
  const start = new Date(Date.now() - 30 * 60 * 1000); // last 30 minutes

  try {
    const data = await cloudwatch.getMetricStatistics({
      Namespace: "ContainerInsights",
      MetricName: "node_gpu_utilization",
      Dimensions: [{ Name: "ClusterName", Value: clusterName }],
      StartTime: start,
      EndTime: end,
      Period: 60,
      Statistics: ["Average", "Maximum"],
    }).promise();

    const points = data.Datapoints.sort((a, b) => a.Timestamp - b.Timestamp);
    res.json({
      cluster: clusterName,
      datapoints: points.map((p) => ({
        time: p.Timestamp,
        avg_utilization_pct: Math.round(p.Average * 10) / 10,
        max_utilization_pct: Math.round(p.Maximum * 10) / 10,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (_, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`GPU cost tracker running on port ${PORT}`));
