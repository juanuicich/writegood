# Proposal: Release Approval by Team Leads

This memo proposes that we move release approval from the weekly Change Advisory Board to the lead of each product team. The board would continue to meet, but only for changes that touch billing, authentication or customer data.

Under the pilot, both teams cut their median wait from six days to under one, and neither shipped a change that had to be rolled back. The results were quite encouraging.

Today every production release needs a sign-off from the board. The board meets on Thursday afternoons. The board makes a determination on each change during the meeting. The board then posts its decisions in the release channel. A change finished on a Friday therefore waits six days. It was decided in 2023 that all changes would go through this process, and at the time we shipped about twenty a week. We now ship about ninety.

Clearly, the board has become a toll booth on the highway to production. Its checklist is cumbersome for a one-line fix, and a weekly schedule made sense only when releases were rare. Concerns have been raised about the delays for over a year. The handoff between the author and the board is cumbersome too, since the author rarely attends. The board's queue is the main bottleneck in our delivery process, and two product launches missed their deadline last quarter because of it.

I want to be clear that this proposal is not a criticism of the board or of the people on it, who have given a great deal of their time over the years. Nor is it an attempt to remove oversight from our release process. As noted above, the board would still review every high-risk change, and nothing in this proposal would change that. Oversight would remain in place for the changes where it matters most, and that point should not be lost.

In March and April, the Payments and Search teams ran a pilot. Each lead approved their own team's releases, and the board reviewed only changes on the high-risk list. Leads recorded each approval in the release ticket, with a link to the passing test run. Admission controllers in the cluster can reject a deploy whose ticket lacks that link. The median wait for approval fell from six days to nineteen hours. It should be noted that the board reviewed eleven changes in those two months, compared with more than three hundred in the same period last year.

The main risk is that a lead approves a change they do not fully understand. Two months is a short period, and the pilot gives us limited evidence on this. Approvals are logged automatically by the deploy tool, so each release ticket would keep a full and complete audit trail. The board would conduct a review of a random sample of ten lead approvals each month. A safety net should catch mistakes without becoming a straitjacket that ties every team to the same Thursday.

Given the results of the pilot and what both teams told us in the May retrospective, I recommend that we extend lead approval to all product teams from the first of November. I would really welcome comments before the managers' meeting on the fourteenth.
