# The base image (evals/Dockerfile) with the planted bug, folded into the baseline commit so history does not show it.
FROM proofstack-eval
COPY bug.patch /tmp/bug.patch
RUN git apply /tmp/bug.patch && rm /tmp/bug.patch && git add --all \
 && git -c core.hooksPath=/dev/null commit --quiet --amend --no-edit
